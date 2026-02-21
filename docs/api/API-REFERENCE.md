# GWI POS API Reference

**Version:** 1.0
**Base URL:** `/api`
**Generated:** 2026-01-30

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Common Patterns](#common-patterns)
4. [API Endpoints](#api-endpoints)
   - [Auth](#auth)
   - [Employees](#employees)
   - [Menu](#menu)
   - [Orders](#orders)
   - [Tables & Sections](#tables--sections)
   - [Customers](#customers)
   - [Reservations](#reservations)
   - [Shifts & Time Clock](#shifts--time-clock)
   - [Payments](#payments)
   - [Gift Cards](#gift-cards)
   - [House Accounts](#house-accounts)
   - [Coupons](#coupons)
   - [Discounts](#discounts)
   - [Events & Tickets](#events--tickets)
   - [Combos](#combos)
   - [Liquor Builder](#liquor-builder)
   - [Entertainment](#entertainment)
   - [Tabs](#tabs)
   - [Roles & Permissions](#roles--permissions)
   - [Tips](#tips)
   - [Settings](#settings)
   - [Reports](#reports)
   - [Inventory](#inventory)
   - [Hardware](#hardware)

---

## Overview

The GWI POS API is a RESTful API built with Next.js App Router. All endpoints follow consistent patterns for requests and responses.

### Response Format

**Success Response:**
```json
{
  "data": { ... }
}
```
or domain-specific wrapper:
```json
{
  "orders": [ ... ],
  "pagination": { ... }
}
```

**Error Response:**
```json
{
  "error": "Error message description"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized |
| 404 | Not Found |
| 409 | Conflict (duplicate) |
| 500 | Internal Server Error |

---

## Authentication

Authentication is PIN-based. Employees log in with their PIN, and the server returns employee info with permissions.

> **Note:** Current implementation does not use JWT tokens. Session management is handled client-side via Zustand stores.

---

## Common Patterns

### Location ID Requirement

**IMPORTANT:** Almost all endpoints require `locationId` as a query parameter (GET) or in the request body (POST/PUT). This is required for multi-tenancy support.

```bash
# GET request
GET /api/orders?locationId=loc_123

# POST request
POST /api/orders
{
  "locationId": "loc_123",
  ...
}
```

### Pagination

List endpoints support pagination:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Max items per page (max 100) |
| `offset` | number | 0 | Items to skip |
| `page` | number | 1 | Page number (alternative to offset) |

**Response includes:**
```json
{
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

### Decimal Fields

All monetary values (prices, totals, etc.) are returned as JavaScript numbers. The API converts Prisma Decimal types automatically.

### Soft Deletes

Records are never hard-deleted. They are soft-deleted with `deletedAt` timestamp for sync compatibility.

---

## API Endpoints

---

## Auth

### POST /api/auth/login

Authenticate employee with PIN.

**Request:**
```json
{
  "pin": "1234",
  "locationId": "loc_123"  // Optional, improves performance
}
```

**Response:**
```json
{
  "employee": {
    "id": "emp_123",
    "firstName": "John",
    "lastName": "Smith",
    "displayName": "John S.",
    "role": {
      "id": "role_123",
      "name": "Server"
    },
    "location": {
      "id": "loc_123",
      "name": "Main Bar"
    },
    "permissions": ["orders.create", "orders.view", "menu.view"]
  }
}
```

**Errors:**
- `400` - PIN must be at least 4 digits
- `401` - Invalid PIN

**Example:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"pin": "1234"}'
```

---

## Employees

### GET /api/employees

List employees for a location.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `includeInactive` | boolean | No | Include inactive employees |
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Items per page (default: 50, max: 100) |

**Response:**
```json
{
  "employees": [
    {
      "id": "emp_123",
      "firstName": "John",
      "lastName": "Smith",
      "displayName": "John S.",
      "email": "john@example.com",
      "phone": "555-1234",
      "role": {
        "id": "role_123",
        "name": "Server",
        "permissions": ["orders.create"]
      },
      "hourlyRate": 15.00,
      "hireDate": "2024-01-15T00:00:00.000Z",
      "isActive": true,
      "color": "#3B82F6",
      "avatarUrl": null,
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 12,
    "totalPages": 1
  }
}
```

### POST /api/employees

Create a new employee.

**Request:**
```json
{
  "locationId": "loc_123",
  "firstName": "Jane",
  "lastName": "Doe",
  "displayName": "Jane D.",
  "email": "jane@example.com",
  "phone": "555-5678",
  "pin": "5678",
  "roleId": "role_123",
  "hourlyRate": 18.50,
  "hireDate": "2024-01-20",
  "color": "#10B981"
}
```

**Errors:**
- `400` - Missing required fields
- `404` - Role not found
- `409` - PIN already exists at this location

### GET /api/employees/[id]

Get employee details.

### PUT /api/employees/[id]

Update employee information.

### GET /api/employees/[id]/open-tabs

Get open tabs/orders for an employee.

### GET /api/employees/[id]/layout

Get employee's POS layout customizations (category colors, item styles).

### PUT /api/employees/[id]/layout

Update employee's POS layout customizations.

---

## Menu

### GET /api/menu

Get all categories and menu items for a location.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | No | Filter by location |

**Response:**
```json
{
  "categories": [
    {
      "id": "cat_123",
      "name": "Appetizers",
      "color": "#EF4444",
      "categoryType": "food",
      "isActive": true,
      "itemCount": 15,
      "printerIds": ["printer_1"]
    }
  ],
  "items": [
    {
      "id": "item_123",
      "categoryId": "cat_123",
      "name": "Buffalo Wings",
      "price": 12.99,
      "description": "Crispy wings with buffalo sauce",
      "isActive": true,
      "isAvailable": true,
      "itemType": "standard",
      "modifierGroupCount": 2,
      "modifierGroups": [
        { "id": "mg_1", "name": "Wing Sauce" }
      ],
      "isLiquorItem": false,
      "hasRecipe": false,
      "pourSizes": null,
      "printerIds": null
    }
  ]
}
```

### POST /api/menu/categories

Create a new category.

**Request:**
```json
{
  "name": "Desserts",
  "color": "#8B5CF6",
  "categoryType": "food",
  "printerIds": ["printer_1"]
}
```

### GET /api/menu/items/[id]/recipe

Get recipe ingredients for a menu item (Liquor Builder).

### POST /api/menu/items/[id]/recipe

Set recipe ingredients for a menu item.

---

## Orders

### GET /api/orders

List orders with optional filters.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `status` | string | No | Filter by status (open, paid, closed) |
| `employeeId` | string | No | Filter by employee |
| `limit` | number | No | Max items (default: 50) |
| `offset` | number | No | Skip items |

**Response:**
```json
{
  "orders": [
    {
      "id": "ord_123",
      "orderNumber": 1042,
      "orderType": "dine_in",
      "status": "open",
      "tableId": "tbl_123",
      "tableName": "Table 5",
      "tabName": null,
      "guestCount": 4,
      "employee": {
        "id": "emp_123",
        "name": "John S."
      },
      "itemCount": 8,
      "subtotal": 85.50,
      "total": 92.34,
      "paidAmount": 0,
      "createdAt": "2024-01-30T18:30:00.000Z"
    }
  ]
}
```

### POST /api/orders

Create a new order.

**Request:**
```json
{
  "locationId": "loc_123",
  "employeeId": "emp_123",
  "orderType": "dine_in",
  "orderTypeId": "ot_123",
  "tableId": "tbl_123",
  "tabName": null,
  "guestCount": 4,
  "notes": "Birthday celebration",
  "customFields": {
    "specialRequest": "Window seat"
  },
  "items": [
    {
      "menuItemId": "item_123",
      "name": "Buffalo Wings",
      "price": 12.99,
      "quantity": 2,
      "seatNumber": 1,
      "courseNumber": 1,
      "specialNotes": "Extra crispy",
      "modifiers": [
        {
          "modifierId": "mod_123",
          "name": "BBQ Sauce",
          "price": 0,
          "preModifier": null,
          "depth": 0
        }
      ],
      "ingredientModifications": [
        {
          "ingredientId": "ing_123",
          "name": "Celery",
          "modificationType": "no",
          "priceAdjustment": 0
        }
      ],
      "pizzaConfig": null
    }
  ]
}
```

**Response includes:**
- Order ID and number
- Calculated subtotal, tax, and total
- Commission total (if items have commission)

### GET /api/orders/[id]

Get order details with items, modifiers, and payments.

**Response includes:**
- Full item details with modifiers
- Pizza configuration (if applicable)
- Entertainment timer info (for timed rentals)
- Ingredient modifications
- Payment summary

### PUT /api/orders/[id]

Update order (add/modify items, update metadata).

**Request:**
```json
{
  "items": [...],
  "tabName": "Smith Party",
  "guestCount": 6,
  "notes": "VIP guests",
  "tipTotal": 15.00
}
```

### POST /api/orders/[id]/pay

Process payment for an order. Supports split payments with multiple payment methods.

**Request:**
```json
{
  "employeeId": "emp_123",
  "payments": [
    {
      "method": "credit",
      "amount": 50.00,
      "tipAmount": 8.00,
      "cardBrand": "visa",
      "cardLast4": "4242"
    },
    {
      "method": "cash",
      "amount": 42.34,
      "tipAmount": 7.00,
      "amountTendered": 60.00
    }
  ]
}
```

**Payment Methods:**
| Method | Required Fields |
|--------|-----------------|
| `cash` | amount, amountTendered (optional) |
| `credit` | amount, cardLast4 |
| `debit` | amount, cardLast4 |
| `gift_card` | amount, giftCardId or giftCardNumber |
| `house_account` | amount, houseAccountId |
| `loyalty_points` | amount, pointsUsed |

**Response:**
```json
{
  "success": true,
  "payments": [...],
  "orderStatus": "paid",
  "remainingBalance": 0,
  "loyaltyPointsEarned": 92,
  "customerId": "cust_123"
}
```

### POST /api/orders/[id]/discount

Apply discount to order.

### POST /api/orders/[id]/split

Split order into multiple checks.

### POST /api/orders/[id]/split-tickets

Split order items into separate tickets.

### POST /api/orders/[id]/merge

Merge orders together.

### POST /api/orders/[id]/transfer-items

Transfer items between orders.

### GET /api/orders/[id]/payments

Get payment history for order.

### GET /api/orders/[id]/receipt

Get receipt data for printing.

### POST /api/orders/[id]/comp-void

Comp or void order/items. Accepts optional `remoteApprovalCode` for SMS-based manager approval.

**Request Body:**
```json
{
  "action": "comp" | "void",
  "itemId": "string",
  "reason": "string",
  "employeeId": "string",
  "approvedById": "string (optional)",
  "remoteApprovalCode": "string (optional, 6-digit code from remote approval)"
}
```

---

## Remote Void Approval (Skill 122)

SMS-based manager approval for voids when no manager is present.

### GET /api/voids/remote-approval/managers

List managers with void permission and phone number.

**Query Parameters:**
- `locationId` - Location ID (required)

**Response:**
```json
{
  "data": {
    "managers": [
      {
        "id": "string",
        "name": "string",
        "phoneMasked": "***-***-1234",
        "roleName": "string"
      }
    ]
  }
}
```

### POST /api/voids/remote-approval/request

Create approval request and send SMS to manager.

**Request Body:**
```json
{
  "locationId": "string",
  "orderId": "string",
  "orderItemId": "string (optional)",
  "voidType": "item" | "order" | "comp",
  "managerId": "string",
  "voidReason": "string",
  "amount": 12.99,
  "itemName": "string",
  "requestedById": "string",
  "terminalId": "string (optional)"
}
```

**Response:**
```json
{
  "data": {
    "approvalId": "string",
    "expiresAt": "ISO timestamp",
    "smsSent": true
  }
}
```

### GET /api/voids/remote-approval/[id]/status

Check approval status (polling fallback).

**Response:**
```json
{
  "data": {
    "status": "pending" | "approved" | "rejected" | "expired" | "used",
    "approvalCode": "123456 (if approved)",
    "managerName": "string"
  }
}
```

### POST /api/voids/remote-approval/validate-code

Validate 6-digit approval code at POS.

**Request Body:**
```json
{
  "orderId": "string",
  "orderItemId": "string (optional)",
  "code": "123456",
  "employeeId": "string"
}
```

**Response:**
```json
{
  "data": {
    "valid": true,
    "approvalId": "string",
    "managerId": "string",
    "managerName": "string"
  }
}
```

### GET /api/voids/remote-approval/[token]

Fetch approval details for mobile approval page (token is 32 hex chars).

### POST /api/voids/remote-approval/[token]/approve

Approve via mobile web page. Generates 6-digit code.

### POST /api/voids/remote-approval/[token]/reject

Reject via mobile web page.

### POST /api/webhooks/twilio/sms

Twilio webhook for inbound SMS replies (YES/NO).

---

### POST /api/orders/[id]/courses

Fire courses for kitchen.

### PUT /api/orders/[id]/items/[itemId]

Update order item.

### DELETE /api/orders/[id]/items/[itemId]

Remove item from order.

### PUT /api/orders/[id]/customer

Assign customer to order.

### GET /api/orders/open

Get all open orders for a location.

### GET /api/orders/closed

Get closed orders with date filtering.

---

## Tables & Sections

### GET /api/tables

List tables for a location.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `sectionId` | string | No | Filter by section |
| `status` | string | No | Filter by status |
| `includeSeats` | boolean | No | Include seat details |

**Response:**
```json
{
  "tables": [
    {
      "id": "tbl_123",
      "name": "Table 5",
      "capacity": 4,
      "posX": 100,
      "posY": 200,
      "width": 100,
      "height": 100,
      "rotation": 0,
      "shape": "rectangle",
      "status": "occupied",
      "section": {
        "id": "sec_123",
        "name": "Main Dining",
        "color": "#3B82F6"
      },
      "combinedWithId": null,
      "combinedTableIds": null,
      "seats": [],
      "currentOrder": {
        "id": "ord_123",
        "orderNumber": 1042,
        "guestCount": 4,
        "total": 85.50,
        "openedAt": "2024-01-30T18:30:00.000Z",
        "server": "John S."
      }
    }
  ]
}
```

### POST /api/tables

Create a new table.

**Request:**
```json
{
  "locationId": "loc_123",
  "sectionId": "sec_123",
  "name": "Table 10",
  "capacity": 6,
  "posX": 250,
  "posY": 300,
  "width": 120,
  "height": 80,
  "shape": "rectangle"
}
```

### GET /api/tables/[id]

Get table details.

### PUT /api/tables/[id]

Update table properties.

### DELETE /api/tables/[id]

Soft delete table.

### GET /api/tables/[id]/seats

List seats for a table.

### POST /api/tables/[id]/seats

Add seat to table.

### POST /api/tables/[id]/seats/auto-generate

Auto-generate seats based on table shape and capacity.

### PUT /api/tables/[id]/seats/bulk

Bulk update seats.

### PUT /api/tables/[id]/seats/[seatId]

Update seat position/properties.

### DELETE /api/tables/[id]/seats/[seatId]

Remove seat.

### POST /api/tables/[id]/transfer

Transfer table to another server.

### GET /api/sections

List sections for a location.

**Response:**
```json
{
  "sections": [
    {
      "id": "sec_123",
      "name": "Main Dining",
      "color": "#3B82F6",
      "tableCount": 15,
      "assignedEmployees": [
        { "id": "emp_123", "name": "John S." }
      ]
    }
  ]
}
```

### POST /api/sections

Create a new section.

---

## Customers

### GET /api/customers

List customers with optional search.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `search` | string | No | Search name, email, phone |
| `tag` | string | No | Filter by tag |
| `limit` | number | No | Max items (default: 50) |
| `offset` | number | No | Skip items |

**Response:**
```json
{
  "customers": [
    {
      "id": "cust_123",
      "firstName": "Alice",
      "lastName": "Johnson",
      "displayName": null,
      "name": "Alice Johnson",
      "email": "alice@example.com",
      "phone": "555-9876",
      "notes": "Prefers booth seating",
      "tags": ["VIP", "Birthday Club"],
      "loyaltyPoints": 1250,
      "totalSpent": 2450.00,
      "totalOrders": 28,
      "averageTicket": 87.50,
      "lastVisit": "2024-01-28T20:15:00.000Z",
      "marketingOptIn": true,
      "birthday": "1985-06-15T00:00:00.000Z",
      "createdAt": "2023-06-01T10:00:00.000Z"
    }
  ],
  "total": 156,
  "limit": 50,
  "offset": 0
}
```

### POST /api/customers

Create a new customer.

**Request:**
```json
{
  "locationId": "loc_123",
  "firstName": "Bob",
  "lastName": "Wilson",
  "displayName": null,
  "email": "bob@example.com",
  "phone": "555-4321",
  "notes": "",
  "tags": ["Regular"],
  "marketingOptIn": true,
  "birthday": "1990-03-22"
}
```

**Errors:**
- `409` - Email or phone already exists

### GET /api/customers/[id]

Get customer details.

### PUT /api/customers/[id]

Update customer information.

---

## Reservations

### GET /api/reservations

List reservations with filters.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `date` | string | No | Filter by date (YYYY-MM-DD) |
| `status` | string | No | Filter by status |
| `tableId` | string | No | Filter by table |

**Response includes:**
- Guest info (name, phone, email)
- Party size and duration
- Table assignment with section
- Special requests and internal notes

### POST /api/reservations

Create a new reservation.

**Request:**
```json
{
  "locationId": "loc_123",
  "guestName": "Smith Party",
  "guestPhone": "555-1111",
  "guestEmail": "smith@example.com",
  "partySize": 8,
  "reservationDate": "2024-02-14",
  "reservationTime": "19:00",
  "duration": 120,
  "tableId": "tbl_123",
  "specialRequests": "Anniversary dinner",
  "internalNotes": "VIP - extra attention",
  "customerId": "cust_123",
  "createdBy": "emp_123"
}
```

**Errors:**
- `409` - Conflicts with event on this date/time
- `400` - Table has conflicting reservation

### GET /api/reservations/[id]

Get reservation details.

### PUT /api/reservations/[id]

Update reservation.

### DELETE /api/reservations/[id]

Cancel reservation.

---

## Shifts & Time Clock

### GET /api/shifts

List shifts with optional filters.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `employeeId` | string | No | Filter by employee |
| `status` | string | No | open or closed |
| `startDate` | string | No | Filter start date |
| `endDate` | string | No | Filter end date |

**Response:**
```json
{
  "shifts": [
    {
      "id": "shift_123",
      "employee": {
        "id": "emp_123",
        "name": "John S."
      },
      "startedAt": "2024-01-30T16:00:00.000Z",
      "endedAt": null,
      "status": "open",
      "startingCash": 200.00,
      "expectedCash": 485.50,
      "actualCash": null,
      "variance": null,
      "totalSales": 1250.00,
      "cashSales": 285.50,
      "cardSales": 964.50,
      "tipsDeclared": null,
      "notes": null
    }
  ]
}
```

### POST /api/shifts

Start a new shift.

**Request:**
```json
{
  "locationId": "loc_123",
  "employeeId": "emp_123",
  "startingCash": 200.00,
  "notes": "Taking over from Sarah"
}
```

**Errors:**
- `400` - Employee already has open shift

### GET /api/time-clock

List time clock entries.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `employeeId` | string | No | Filter by employee |
| `startDate` | string | No | Filter start date |
| `endDate` | string | No | Filter end date |
| `openOnly` | boolean | No | Only show clocked-in entries |

### POST /api/time-clock

Clock in an employee.

**Request:**
```json
{
  "locationId": "loc_123",
  "employeeId": "emp_123",
  "notes": "Covering for Mike"
}
```

### PUT /api/time-clock

Clock out, start break, or end break.

**Request:**
```json
{
  "entryId": "entry_123",
  "action": "clockOut",  // clockOut, startBreak, endBreak
  "notes": "End of shift"
}
```

**Response includes:**
- Regular hours and overtime hours (over 8 hours)
- Break minutes
- Break status

### GET /api/breaks

List break records.

### POST /api/breaks

Start a break.

---

## Gift Cards

### GET /api/gift-cards

List gift cards.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `status` | string | No | active, depleted, expired |
| `search` | string | No | Search card number, recipient |

**Response:**
```json
[
  {
    "id": "gc_123",
    "cardNumber": "GC-ABCD-1234-EFGH-5678",
    "initialBalance": 100.00,
    "currentBalance": 45.50,
    "status": "active",
    "recipientName": "Jane Doe",
    "recipientEmail": "jane@example.com",
    "purchaserName": "John Smith",
    "message": "Happy Birthday!",
    "expiresAt": null,
    "_count": { "transactions": 3 }
  }
]
```

### POST /api/gift-cards

Purchase a new gift card.

**Request:**
```json
{
  "locationId": "loc_123",
  "amount": 50.00,
  "recipientName": "Jane Doe",
  "recipientEmail": "jane@example.com",
  "recipientPhone": "555-1234",
  "purchaserName": "John Smith",
  "message": "Enjoy!",
  "purchasedById": "emp_123",
  "orderId": "ord_123",
  "expiresAt": null
}
```

**Response includes:**
- Auto-generated card number (format: GC-XXXX-XXXX-XXXX-XXXX)
- Initial transaction record

### GET /api/gift-cards/[id]

Get gift card details with transaction history.

### PUT /api/gift-cards/[id]

Update gift card (add value, deactivate, etc.).

---

## House Accounts

### GET /api/house-accounts

List house accounts.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `status` | string | No | active, suspended, closed |
| `search` | string | No | Search name, contact, email |

**Response:**
```json
[
  {
    "id": "ha_123",
    "name": "ABC Company",
    "contactName": "Bob Johnson",
    "email": "bob@abc.com",
    "phone": "555-9999",
    "creditLimit": 5000.00,
    "currentBalance": 1250.00,
    "paymentTerms": 30,
    "billingCycle": "monthly",
    "status": "active",
    "taxExempt": false,
    "customer": {
      "id": "cust_123",
      "firstName": "Bob",
      "lastName": "Johnson"
    },
    "_count": { "transactions": 15 }
  }
]
```

### POST /api/house-accounts

Create a new house account.

**Request:**
```json
{
  "locationId": "loc_123",
  "name": "XYZ Corp",
  "contactName": "Sarah Wilson",
  "email": "sarah@xyz.com",
  "phone": "555-8888",
  "address": "123 Business St",
  "creditLimit": 2500.00,
  "paymentTerms": 30,
  "billingCycle": "monthly",
  "taxExempt": false,
  "taxId": null,
  "customerId": "cust_456"
}
```

**Errors:**
- `400` - Account name already exists

### GET /api/house-accounts/[id]

Get account details with transactions.

### PUT /api/house-accounts/[id]

Update account (adjust credit limit, suspend, etc.).

---

## Coupons

### GET /api/coupons

List coupons or lookup by code.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `activeOnly` | boolean | No | Only active coupons |
| `code` | string | No | Lookup specific code for redemption |

**When `code` is provided, validates:**
- Coupon exists and is active
- Within valid date range
- Usage limit not exceeded

### POST /api/coupons

Create a new coupon.

**Request:**
```json
{
  "locationId": "loc_123",
  "code": "SUMMER25",
  "name": "Summer Special",
  "description": "25% off entire order",
  "discountType": "percent",
  "discountValue": 25,
  "minimumOrder": 50.00,
  "maximumDiscount": 30.00,
  "appliesTo": "order",
  "categoryIds": null,
  "itemIds": null,
  "usageLimit": 100,
  "perCustomerLimit": 1,
  "singleUse": false,
  "validFrom": "2024-06-01",
  "validUntil": "2024-08-31",
  "createdBy": "emp_123"
}
```

**Discount Types:**
- `percent` - Percentage discount
- `fixed` - Fixed dollar amount
- `free_item` - Free item (requires `freeItemId`)

**Applies To:**
- `order` - Entire order
- `category` - Specific categories
- `item` - Specific items

### GET /api/coupons/[id]

Get coupon details.

### PUT /api/coupons/[id]

Update coupon.

### DELETE /api/coupons/[id]

Deactivate coupon.

---

## Discounts

### GET /api/discounts

List discount rules.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `activeOnly` | boolean | No | Only active discounts |
| `manualOnly` | boolean | No | Only manual (not automatic) discounts |

**Response:**
```json
{
  "discounts": [
    {
      "id": "disc_123",
      "name": "Happy Hour",
      "displayText": "50% Off",
      "description": "Half price drinks 4-6 PM",
      "discountType": "time_based",
      "discountConfig": {
        "type": "percent",
        "value": 50
      },
      "triggerConfig": {
        "categoryTypes": ["liquor"]
      },
      "scheduleConfig": {
        "days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
        "startTime": "16:00",
        "endTime": "18:00"
      },
      "priority": 10,
      "isStackable": false,
      "requiresApproval": false,
      "maxPerOrder": null,
      "isActive": true,
      "isAutomatic": true
    }
  ]
}
```

### POST /api/discounts

Create a new discount rule.

### GET /api/discounts/[id]

Get discount details.

### PUT /api/discounts/[id]

Update discount rule.

### DELETE /api/discounts/[id]

Deactivate discount.

---

## Events & Tickets

### GET /api/events

List events.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `status` | string | No | draft, on_sale, sold_out, completed |
| `date` | string | No | Specific date |
| `upcoming` | boolean | No | Only future events |

**Response:**
```json
{
  "events": [
    {
      "id": "evt_123",
      "name": "Valentine's Dinner Show",
      "description": "Special dinner and live music",
      "imageUrl": "https://...",
      "eventType": "dinner_show",
      "eventDate": "2024-02-14",
      "doorsOpen": "18:00",
      "startTime": "19:00",
      "endTime": "22:00",
      "ticketingMode": "per_seat",
      "allowOnlineSales": true,
      "allowPOSSales": true,
      "maxTicketsPerOrder": 8,
      "totalCapacity": 120,
      "reservedCapacity": 20,
      "status": "on_sale",
      "soldCount": 85,
      "availableCount": 15,
      "pricingTiers": [
        { "id": "tier_1", "name": "General", "price": 75.00, "color": "#3B82F6" },
        { "id": "tier_2", "name": "VIP", "price": 125.00, "color": "#8B5CF6" }
      ]
    }
  ]
}
```

### POST /api/events

Create a new event.

**Request:**
```json
{
  "locationId": "loc_123",
  "name": "Live Band Night",
  "description": "Rock covers all night",
  "eventType": "concert",
  "eventDate": "2024-03-15",
  "doorsOpen": "19:00",
  "startTime": "20:00",
  "endTime": "23:00",
  "ticketingMode": "general_admission",
  "totalCapacity": 200,
  "reservedCapacity": 0,
  "pricingTiers": [
    { "name": "General", "price": 25.00, "color": "#3B82F6" }
  ],
  "createdBy": "emp_123"
}
```

**Response includes:**
- Created event (as draft)
- Conflicting reservations that must be resolved

### GET /api/events/[id]

Get event details.

### PUT /api/events/[id]

Update event.

### DELETE /api/events/[id]

Cancel event.

### POST /api/events/[id]/publish

Publish event for sale.

### GET /api/events/[id]/availability

Get seat/ticket availability.

### GET /api/events/[id]/conflicts

Get conflicting reservations.

### POST /api/events/[id]/resolve-conflicts

Resolve reservation conflicts.

### POST /api/events/[id]/tickets/hold

Hold tickets for a customer.

### POST /api/events/[id]/tickets/purchase

Purchase tickets.

### POST /api/events/[id]/tickets/release

Release held tickets.

### GET /api/tickets

Search/list tickets.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `eventId` | string | One required | Filter by event |
| `locationId` | string | One required | Filter by location |
| `status` | string | No | sold, held, cancelled, refunded |
| `customerId` | string | No | Filter by customer |
| `search` | string | No | Search name, email, ticket number |

### GET /api/tickets/[id]

Get ticket details.

### POST /api/tickets/[id]/check-in

Check in ticket at door.

### POST /api/tickets/[id]/refund

Refund ticket.

---

## Combos

### GET /api/combos

List combo menu items with templates.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |

**Response:**
```json
{
  "combos": [
    {
      "id": "item_123",
      "name": "Burger Combo",
      "displayName": "Classic Burger Combo",
      "description": "Burger, fries, and drink",
      "price": 15.99,
      "categoryId": "cat_123",
      "categoryName": "Combos",
      "isActive": true,
      "isAvailable": true,
      "template": {
        "id": "tmpl_123",
        "basePrice": 15.99,
        "comparePrice": 18.99,
        "components": [
          {
            "id": "comp_1",
            "slotName": "main",
            "displayName": "Choose Your Burger",
            "sortOrder": 0,
            "isRequired": true,
            "minSelections": 1,
            "maxSelections": 1,
            "menuItemId": "item_burger",
            "menuItem": {
              "id": "item_burger",
              "name": "Classic Burger",
              "price": 12.99,
              "modifierGroups": [...]
            }
          },
          {
            "id": "comp_2",
            "slotName": "side",
            "displayName": "Choose a Side",
            "isRequired": true,
            "menuItemId": null,
            "options": [
              { "name": "Fries", "price": 0 },
              { "name": "Onion Rings", "price": 1.50 }
            ]
          }
        ]
      }
    }
  ]
}
```

### POST /api/combos

Create a new combo.

### GET /api/combos/[id]

Get combo details.

### PUT /api/combos/[id]

Update combo.

### DELETE /api/combos/[id]

Deactivate combo.

---

## Liquor Builder

### GET /api/liquor/bottles

List bottle products.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tier` | string | No | well, call, premium, top_shelf |
| `spiritCategoryId` | string | No | Filter by spirit category |
| `isActive` | boolean | No | Filter by active status |

**Response:**
```json
[
  {
    "id": "btl_123",
    "name": "Grey Goose",
    "brand": "Grey Goose",
    "displayName": null,
    "spiritCategoryId": "scat_vodka",
    "spiritCategory": {
      "id": "scat_vodka",
      "name": "vodka",
      "displayName": "Vodka"
    },
    "tier": "premium",
    "bottleSizeMl": 750,
    "bottleSizeOz": 25.36,
    "unitCost": 28.00,
    "pourSizeOz": 1.5,
    "poursPerBottle": 16,
    "pourCost": 1.75,
    "currentStock": 12,
    "lowStockAlert": 3,
    "isActive": true
  }
]
```

### POST /api/liquor/bottles

Create bottle product with auto-calculated metrics.

**Request:**
```json
{
  "name": "Tito's Handmade Vodka",
  "brand": "Tito's",
  "spiritCategoryId": "scat_vodka",
  "tier": "call",
  "bottleSizeMl": 1000,
  "unitCost": 22.00,
  "pourSizeOz": 1.5,
  "currentStock": 24,
  "lowStockAlert": 6
}
```

**Auto-calculated:**
- `bottleSizeOz` - Converted from mL
- `poursPerBottle` - Based on bottle size and pour size
- `pourCost` - Unit cost / pours per bottle

### GET /api/liquor/categories

List spirit categories (Vodka, Gin, Tequila, etc.).

### POST /api/liquor/categories

Create spirit category.

### GET /api/liquor/recipes

Get cocktail recipes (menu items linked to bottles).

### POST /api/liquor/recipes

Create/update cocktail recipe.

### GET /api/liquor/upsells

Get spirit upsell suggestions.

---

## Entertainment

### GET /api/entertainment/status

Get status of all entertainment items (pool tables, darts, etc.).

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |

### PUT /api/entertainment/status

Update entertainment item status.

**Request:**
```json
{
  "menuItemId": "item_pool1",
  "status": "maintenance",
  "notes": "Felt needs repair"
}
```

### POST /api/entertainment/block-time

Start block time session for entertainment item.

### GET /api/timed-sessions

List active timed sessions.

### POST /api/timed-sessions

Start a new timed session.

### PUT /api/timed-sessions/[id]

Extend or stop session.

### DELETE /api/timed-sessions/[id]

Cancel session.

### GET /api/entertainment/waitlist

Get entertainment waitlist.

### POST /api/entertainment/waitlist

Add to waitlist.

### PUT /api/entertainment/waitlist/[id]

Update waitlist entry.

### DELETE /api/entertainment/waitlist/[id]

Remove from waitlist.

---

## Tabs

### GET /api/tabs

List open bar tabs.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `employeeId` | string | No | Filter by server |
| `status` | string | No | Filter by status |

### POST /api/tabs

Create a new bar tab.

### GET /api/tabs/[id]

Get tab details.

### PUT /api/tabs/[id]

Update tab (add card on file, update name, etc.).

### POST /api/tabs/[id]/transfer

Transfer tab to another server.

---

## Roles & Permissions

### GET /api/roles

List roles for a location.

**Response:**
```json
{
  "roles": [
    {
      "id": "role_123",
      "name": "Server",
      "permissions": ["orders.create", "orders.view", "menu.view", "tips.view_own"],
      "isTipped": true,
      "employeeCount": 8,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "availablePermissions": [
    { "key": "ORDERS_CREATE", "value": "orders.create", "category": "orders" },
    { "key": "ORDERS_VIEW", "value": "orders.view", "category": "orders" }
  ]
}
```

### POST /api/roles

Create a new role.

**Request:**
```json
{
  "locationId": "loc_123",
  "name": "Bartender",
  "permissions": ["orders.create", "orders.view", "menu.view", "tips.view_own", "bar.manage"]
}
```

### GET /api/roles/[id]

Get role details.

### PUT /api/roles/[id]

Update role permissions.

### DELETE /api/roles/[id]

Delete role (only if no employees assigned).

---

## Tips

### GET /api/tip-out-rules

List automatic tip-out rules.

**Response:**
```json
{
  "data": [
    {
      "id": "tor_123",
      "fromRole": { "id": "role_server", "name": "Server", "isTipped": true },
      "toRole": { "id": "role_busser", "name": "Busser", "isTipped": true },
      "percentage": 3.0
    }
  ]
}
```

### POST /api/tip-out-rules

Create tip-out rule.

**Request:**
```json
{
  "locationId": "loc_123",
  "fromRoleId": "role_server",
  "toRoleId": "role_busser",
  "percentage": 3.0
}
```

**Errors:**
- `400` - From and to role cannot be the same
- `409` - Rule already exists for this role combination

### PUT /api/tip-out-rules/[id]

Update rule percentage.

### DELETE /api/tip-out-rules/[id]

Delete tip-out rule.

---

## Settings

### GET /api/tax-rules

List tax rules.

### POST /api/tax-rules

Create tax rule.

### PUT /api/tax-rules/[id]

Update tax rule.

### DELETE /api/tax-rules/[id]

Delete tax rule.

### GET /api/order-types

List configurable order types.

### POST /api/order-types

Create custom order type.

### PUT /api/order-types/[id]

Update order type.

### DELETE /api/order-types/[id]

Delete order type (if not system type).

### GET /api/prep-stations

List kitchen prep stations.

### POST /api/prep-stations

Create prep station.

### PUT /api/prep-stations/[id]

Update prep station.

### DELETE /api/prep-stations/[id]

Delete prep station.

---

## Reports

### GET /api/reports/daily

Comprehensive daily store report (EOD).

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `date` | string | No | Report date (default: today) |

**Response includes:**
- Revenue summary (gross, net, tax, tips)
- Payment breakdown by method
- Category sales
- Labor costs and hours
- Tip distribution
- Order statistics

### GET /api/reports/sales

Comprehensive sales report with groupings.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locationId` | string | Yes | Location ID |
| `startDate` | string | No | Start date |
| `endDate` | string | No | End date |
| `employeeId` | string | No | Filter by employee |
| `orderType` | string | No | Filter by order type |
| `tableId` | string | No | Filter by table |

**Response includes:**
- Summary totals
- Sales by day, hour, category, item
- Sales by employee, table, seat
- Sales by order type, modifier
- Payment method breakdown

### GET /api/reports/labor

Labor report with hours and costs.

### GET /api/reports/tips

Tips report with distributions.

### GET /api/reports/commission

Commission report by employee.

### GET /api/reports/customers

Customer analytics report.

### GET /api/reports/discounts

Discount usage report.

### GET /api/reports/coupons

Coupon redemption report.

### GET /api/reports/voids

Voided items/orders report.

### GET /api/reports/transfers

Table/order transfer report.

### GET /api/reports/employees

Employee performance report.

### GET /api/reports/tables

Table utilization report.

### GET /api/reports/reservations

Reservation report.

### GET /api/reports/product-mix

Product mix analysis.

### GET /api/reports/order-history

Detailed order history.

### GET /api/reports/liquor

Liquor sales and cost analysis.

---

## Inventory

### GET /api/inventory

List inventory items.

### POST /api/inventory

Create inventory item.

### GET /api/stock-alerts

Get low stock alerts.

### GET /api/ingredients

List menu item ingredients.

---

## Hardware

> Hardware endpoints are documented separately in `/docs/skills/102-KDS-DEVICE-SECURITY.md`

### Key Hardware Endpoints:

- `GET /api/hardware/printers` - List printers
- `POST /api/hardware/printers` - Add printer
- `GET /api/hardware/kds-screens` - List KDS screens
- `POST /api/hardware/kds-screens/[id]/generate-code` - Generate pairing code
- `POST /api/hardware/kds-screens/pair` - Complete device pairing
- `GET /api/hardware/kds-screens/auth` - Verify device authentication
- `POST /api/hardware/print-routes` - Configure print routing

---

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Human-readable error message"
}
```

**Common Error Codes:**

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 400 | Bad Request | Missing required fields, invalid data |
| 401 | Unauthorized | Invalid PIN, expired session |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate entry, constraint violation |
| 500 | Server Error | Database error, unexpected exception |

---

## Rate Limiting

Currently no rate limiting is implemented. This is intended for local server deployment where all traffic is on the local network.

---

## Versioning

The API does not currently use versioning. Breaking changes will be documented in release notes.

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-30 | 1.0 | Initial documentation |
