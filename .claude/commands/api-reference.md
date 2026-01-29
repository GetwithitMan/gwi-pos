# API Reference

Complete API endpoint documentation.

## Base URL
```
http://localhost:3000/api
```

## Authentication

Most endpoints require location context:
```
?locationId=loc-1
```

## Response Format

### Success
```json
{
  "data": { ... }
}
```

### Error
```json
{
  "error": "Error message",
  "details": "Additional info"
}
```

---

## Orders

### List Open Orders
```
GET /api/orders/open?locationId=xxx
```

### List Closed Orders
```
GET /api/orders/closed?locationId=xxx
```

### Get Order
```
GET /api/orders/[id]
```

### Create Order
```
POST /api/orders
{
  "employeeId": "xxx",
  "locationId": "xxx",
  "orderType": "dine_in",
  "orderTypeId": "xxx",
  "tableId": "xxx",
  "tabName": "John",
  "guestCount": 4,
  "items": [
    {
      "menuItemId": "xxx",
      "name": "Burger",
      "price": 12.99,
      "quantity": 2,
      "modifiers": [],
      "specialNotes": "No onion"
    }
  ],
  "customFields": {}
}
```

### Update Order
```
PATCH /api/orders/[id]
{
  "status": "sent",
  "tabName": "Updated Name"
}
```

### Add Items to Order
```
POST /api/orders/[id]/items
{
  "items": [...]
}
```

### Void Order
```
POST /api/orders/[id]/void
{
  "reason": "Customer left",
  "approvedBy": "manager-id"
}
```

---

## Menu

### Get Full Menu
```
GET /api/menu?locationId=xxx
```

### Categories

```
GET /api/menu/categories?locationId=xxx
POST /api/menu/categories
PUT /api/menu/categories/[id]
DELETE /api/menu/categories/[id]
```

### Menu Items

```
GET /api/menu/items?locationId=xxx&categoryId=xxx
POST /api/menu/items
PUT /api/menu/items/[id]
DELETE /api/menu/items/[id]
```

### Modifiers

```
GET /api/menu/modifiers?locationId=xxx
POST /api/menu/modifiers
PUT /api/menu/modifiers/[id]
DELETE /api/menu/modifiers/[id]
```

---

## Order Types

### List Order Types
```
GET /api/order-types?locationId=xxx
GET /api/order-types?locationId=xxx&includeInactive=true
```

### Create Order Type
```
POST /api/order-types
{
  "locationId": "xxx",
  "name": "Drive Thru",
  "slug": "drive_thru",
  "color": "#06B6D4",
  "icon": "car",
  "requiredFields": {},
  "fieldDefinitions": {},
  "workflowRules": {}
}
```

### Update Order Type
```
PUT /api/order-types/[id]
```

### Delete Order Type
```
DELETE /api/order-types/[id]
```

---

## Employees

### List Employees
```
GET /api/employees?locationId=xxx
```

### Get Employee
```
GET /api/employees/[id]
```

### Create Employee
```
POST /api/employees
{
  "locationId": "xxx",
  "firstName": "John",
  "lastName": "Doe",
  "pin": "1234",
  "roleId": "xxx"
}
```

### Update Employee
```
PUT /api/employees/[id]
```

---

## Tables & Sections

### List Tables
```
GET /api/tables?locationId=xxx
```

### List Sections
```
GET /api/sections?locationId=xxx
```

### Create Table
```
POST /api/tables
{
  "locationId": "xxx",
  "sectionId": "xxx",
  "name": "T5",
  "capacity": 4
}
```

---

## Payments

### Process Payment
```
POST /api/payments
{
  "orderId": "xxx",
  "method": "cash",
  "amount": 45.50,
  "tipAmount": 8.00,
  "cashTendered": 60.00
}
```

### Pre-Authorization
```
POST /api/payments/pre-auth
{
  "orderId": "xxx",
  "cardToken": "xxx",
  "holdAmount": 100.00
}
```

### Refund
```
POST /api/payments/[id]/refund
{
  "amount": 45.50,
  "reason": "Customer complaint"
}
```

---

## Shifts

### Current Shift
```
GET /api/shifts/current?employeeId=xxx
```

### Start Shift
```
POST /api/shifts
{
  "employeeId": "xxx",
  "locationId": "xxx",
  "openingCash": 200.00
}
```

### End Shift
```
PATCH /api/shifts/[id]/close
{
  "closingCash": 485.50
}
```

---

## KDS

### Get KDS Orders
```
GET /api/kds?locationId=xxx
```

### Mark Item Complete
```
PATCH /api/kds/items/[id]/complete
```

### Bump Order
```
POST /api/kds/orders/[id]/bump
```

---

## Reports

### Sales Report
```
GET /api/reports/sales?locationId=xxx&startDate=2026-01-01&endDate=2026-01-31
```

### Labor Report
```
GET /api/reports/labor?locationId=xxx&date=2026-01-28
```

### Product Mix
```
GET /api/reports/product-mix?locationId=xxx&startDate=xxx&endDate=xxx
```

---

## Customers

### List Customers
```
GET /api/customers?locationId=xxx&search=john
```

### Create Customer
```
POST /api/customers
{
  "locationId": "xxx",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "555-1234"
}
```

---

## Reservations

### List Reservations
```
GET /api/reservations?locationId=xxx&date=2026-01-28
```

### Create Reservation
```
POST /api/reservations
{
  "locationId": "xxx",
  "guestName": "Smith",
  "partySize": 4,
  "dateTime": "2026-01-28T19:00:00Z"
}
```

---

## Inventory

### Get Inventory
```
GET /api/inventory?locationId=xxx
```

### Adjust Stock
```
POST /api/inventory/transactions
{
  "locationId": "xxx",
  "menuItemId": "xxx",
  "type": "adjustment",
  "quantityChange": -5,
  "reason": "Waste"
}
```

---

## Settings

### Get Settings
```
GET /api/settings?locationId=xxx
```

### Update Settings
```
PATCH /api/settings
{
  "locationId": "xxx",
  "settings": { ... }
}
```

---

## Authentication

### Login
```
POST /api/auth/login
{
  "pin": "1234",
  "locationId": "loc-1"
}
```

### Validate Session
```
GET /api/auth/session
```

### Logout
```
POST /api/auth/logout
```

---

## Entertainment

### Start Session
```
POST /api/entertainment/block-time
{
  "orderItemId": "xxx",
  "minutes": 60
}
```

### Extend Session
```
PATCH /api/entertainment/block-time
{
  "orderItemId": "xxx",
  "additionalMinutes": 30
}
```

### Stop Session
```
DELETE /api/entertainment/block-time?orderItemId=xxx
```

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Login required |
| 403 | Forbidden - Permission denied |
| 404 | Not Found - Resource missing |
| 409 | Conflict - Duplicate data |
| 500 | Server Error - Bug or crash |
