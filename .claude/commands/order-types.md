# Configurable Order Types

Create and manage custom order types with required fields, workflow rules, and KDS display options.

## Overview

The order types system replaces hardcoded order types (dine_in, takeout, delivery, bar_tab) with admin-configurable types that support custom fields, validation rules, and workflow controls.

## Default Order Types

| Type | Slug | Required Fields | Workflow Rules |
|------|------|-----------------|----------------|
| Table | `dine_in` | tableId | requireTableSelection: true |
| Bar Tab | `bar_tab` | tabName | requireCustomerName: true |
| Takeout | `takeout` | - | requirePaymentBeforeSend: true |
| Delivery | `delivery` | address, phone | - |
| Drive Thru | `drive_thru` | customerName, vehicleType, vehicleColor | - |
| Call-in | `call_in` | name, phone, pickupTime | - |

## Admin Management

### Access Order Types Settings
1. Go to Settings (`/settings`)
2. Click "Order Types" in Quick Links
3. Or navigate directly to `/settings/order-types`

### Create New Order Type
1. Click "Add Order Type" button
2. Fill in basic info:
   - **Name**: Display name (e.g., "Drive Thru")
   - **Slug**: Code identifier (e.g., "drive_thru")
   - **Color**: Badge/button color (hex code)
   - **Icon**: Icon name (table, wine, bag, truck, phone, car)
3. Configure required fields
4. Set workflow rules
5. Click "Create"

### Edit Order Type
1. Click pencil icon on any order type
2. Modify settings
3. System types have limited editing (cannot delete or change slug)

### Toggle Active/Inactive
- Click toggle switch to show/hide order type in POS
- Inactive types don't appear on orders page
- Existing orders retain their type

## Field Configuration

### Available Field Types

| Type | Description | UI Display |
|------|-------------|------------|
| `text` | Single line text input | Standard input |
| `textarea` | Multi-line text | Expandable textarea |
| `phone` | Phone number | Phone input with formatting |
| `time` | Time picker | Native time input |
| `select` | Selection from options | Button grid (touch-friendly) |

### Required vs Optional Fields
- **Required**: Must be filled before starting order
- **Optional**: Shown in modal but can be skipped

### Field Definition Structure
```json
{
  "customerName": {
    "label": "Customer Name",
    "type": "text",
    "placeholder": "Name for order",
    "required": true
  },
  "vehicleType": {
    "label": "Vehicle Type",
    "type": "select",
    "required": true,
    "options": [
      {"value": "sedan", "label": "Sedan"},
      {"value": "suv", "label": "SUV"},
      {"value": "truck", "label": "Pickup Truck"}
    ]
  }
}
```

## Workflow Rules

Configure validation rules that apply when sending orders to kitchen.

| Rule | Effect |
|------|--------|
| `requireTableSelection` | Must select table before sending |
| `requireCustomerName` | Must have tab name or customer name |
| `requirePaymentBeforeSend` | Must pay before sending to kitchen |
| `allowSplitCheck` | Whether split check is allowed |
| `showOnKDS` | Whether to display on KDS |

## POS Order Flow

### Starting an Order

1. **Select Order Type**
   - Order type buttons appear at top of orders page
   - Only active types are shown
   - Button shows icon and name with configured color

2. **Custom Fields Modal**
   - If order type has required fields, modal opens automatically
   - Fill in required fields (marked with *)
   - Select options use touch-friendly button grids
   - Color fields show actual colors as backgrounds

3. **Table Selection** (if required)
   - If `requireTableSelection` is true, table picker opens
   - Select table from floor plan
   - Order starts with table assigned

4. **Order Creation**
   - Order created with:
     - `orderType`: slug (e.g., "drive_thru")
     - `orderTypeId`: reference to OrderType record
     - `customFields`: collected field values

### Pre-Send Validation

Before "Send to Kitchen", the system validates:
- All required workflow rules are satisfied
- Payment completed if `requirePaymentBeforeSend`
- Table selected if `requireTableSelection`
- All required custom fields have values

## Display in Open Orders

Custom order types display correctly in Open Orders panel:
- Shows order type name from configuration
- Uses configured color for badge
- Displays custom fields (e.g., vehicle info for drive thru)

## KDS Display

Order type configuration affects KDS display:

| Config | Effect |
|--------|--------|
| `kdsConfig.badgeText` | Badge template (e.g., "Table {tableNumber}") |
| `kdsConfig.badgeColor` | Badge background color |
| `kdsConfig.showPhone` | Display phone number prominently |

## API Endpoints

### List Order Types
```
GET /api/order-types?locationId=xxx
```
Returns only active order types (for POS).

```
GET /api/order-types?locationId=xxx&includeInactive=true
```
Returns all order types including inactive (for admin).

### Create Order Type
```
POST /api/order-types
{
  "locationId": "xxx",
  "name": "Call-in",
  "slug": "call_in",
  "color": "#14B8A6",
  "icon": "phone",
  "requiredFields": {"customerName": true, "phone": true},
  "fieldDefinitions": {...},
  "workflowRules": {...}
}
```

### Update Order Type
```
PUT /api/order-types/[id]
{
  "name": "Updated Name",
  "isActive": false
}
```

### Delete Order Type
```
DELETE /api/order-types/[id]
```
Note: System types cannot be deleted.

### Initialize System Types
```
PUT /api/order-types
{
  "locationId": "xxx"
}
```
Creates default system order types for a new location.

## Database Schema

### OrderType Model
```prisma
model OrderType {
  id         String   @id @default(cuid())
  locationId String
  location   Location @relation(...)

  name        String   // Display name
  slug        String   // Code reference
  description String?
  color       String?  // Hex color
  icon        String?  // Icon name
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)
  isSystem    Boolean  @default(false)

  // JSON Configuration
  requiredFields   Json?  // { "tableId": true, "phone": true }
  optionalFields   Json?
  fieldDefinitions Json?  // Field types, labels, validation
  workflowRules    Json?  // { "requirePaymentBeforeSend": true }
  kdsConfig        Json?  // KDS display formatting
  printConfig      Json?  // Kitchen ticket formatting

  orders    Order[]

  @@unique([locationId, slug])
  @@index([locationId])
}
```

### Order Model Updates
```prisma
model Order {
  // ... existing fields
  orderTypeId   String?
  orderTypeRef  OrderType? @relation(...)
  customFields  Json?  // { "phone": "555-1234", "vehicleColor": "blue" }
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/types/order-types.ts` | Type definitions and system type configs |
| `src/app/api/order-types/route.ts` | Order types CRUD API |
| `src/app/api/order-types/[id]/route.ts` | Single order type operations |
| `src/app/(admin)/settings/order-types/page.tsx` | Admin management page |
| `src/components/orders/OrderTypeSelector.tsx` | POS order type buttons |
| `src/components/orders/OpenOrdersPanel.tsx` | Open orders with type display |
| `src/app/api/orders/open/route.ts` | Open orders API with type config |
| `src/lib/validations.ts` | Order validation schemas |
| `src/stores/order-store.ts` | Order state with customFields |

## Example: Drive Thru Setup

1. **Create Order Type** (via SQL or admin):
```sql
INSERT INTO OrderType (
  id, locationId, name, slug, color, icon,
  isActive, isSystem, sortOrder,
  requiredFields, fieldDefinitions
) VALUES (
  'order-type-drive-thru',
  'loc-1',
  'Drive Thru',
  'drive_thru',
  '#06B6D4',
  'car',
  true,
  false,
  4,
  '{"customerName": true, "vehicleType": true, "vehicleColor": true}',
  '{
    "customerName": {"label": "Customer Name", "type": "text", "required": true},
    "vehicleType": {"label": "Vehicle Type", "type": "select", "required": true,
      "options": [
        {"value": "sedan", "label": "Sedan"},
        {"value": "suv", "label": "SUV"},
        {"value": "truck", "label": "Pickup Truck"}
      ]
    },
    "vehicleColor": {"label": "Vehicle Color", "type": "select", "required": true,
      "options": [
        {"value": "black", "label": "Black"},
        {"value": "white", "label": "White"},
        {"value": "silver", "label": "Silver"},
        {"value": "red", "label": "Red"},
        {"value": "blue", "label": "Blue"}
      ]
    }
  }'
);
```

2. **POS Flow**:
   - Click "Drive Thru" button (cyan with car icon)
   - Modal opens with name field and button grids
   - Select vehicle type (e.g., "SUV")
   - Select vehicle color (buttons show actual colors)
   - Click "Start Order"
   - Add items, send to kitchen
   - Order shows "Drive Thru" badge in open orders

## Troubleshooting

### Order Type Not Showing
- Check `isActive` is true in database
- Verify locationId matches current location
- Confirm API returns the type: `GET /api/order-types?locationId=xxx`

### Custom Fields Not Saving
- Ensure `orderTypeId` is passed to `startOrder()`
- Check `customFields` is included in order creation API call
- Verify Prisma schema has `customFields Json?` on Order model

### Wrong Badge in Open Orders
- Order must have `orderTypeId` set (not just `orderType` slug)
- API must include `orderTypeRef` relation in query
- OpenOrdersPanel must use `getOrderTypeDisplay()` function
