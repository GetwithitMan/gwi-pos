# Skill 134: Vendor Management

## Overview
Track vendors, their products, and compare prices across suppliers.

## Status: Planned

## Problem
Restaurants often order the same items from multiple vendors:
- No way to track who supplies what
- Can't compare prices across vendors
- No history of vendor performance
- Reordering requires remembering vendor details

## Solution

### Schema
```prisma
model Vendor {
  id          String    @id @default(cuid())
  locationId  String
  location    Location  @relation(fields: [locationId], references: [id])

  name        String
  code        String?   // Short code like "SYS" for Sysco
  phone       String?
  email       String?
  website     String?

  // Contact
  contactName  String?
  accountNumber String?

  // Delivery schedule
  deliveryDays   String[]  // ["monday", "thursday"]
  orderCutoff    String?   // "2pm day before"
  leadTimeDays   Int?      // Days from order to delivery

  // Notes
  notes       String?

  isActive    Boolean   @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?
  syncedAt    DateTime?

  // Relations
  products    VendorProduct[]
  invoices    Invoice[]

  @@unique([locationId, name])
  @@index([locationId])
}

model VendorProduct {
  id          String    @id @default(cuid())
  vendorId    String
  vendor      Vendor    @relation(fields: [vendorId], references: [id])

  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])

  // Vendor-specific info
  vendorSku     String?   // Vendor's product code
  vendorName    String?   // Name on vendor's invoice
  packSize      String?   // "50 lb bag", "6/#10 cans"

  // Pricing
  lastPrice     Decimal?
  lastPriceDate DateTime?

  // Ordering
  minOrderQty   Int?
  casePack      Int?      // Units per case

  isPreferred   Boolean   @default(false)  // Primary vendor for this item

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  @@unique([vendorId, ingredientId])
  @@index([ingredientId])
}
```

### UI - Vendor List
```
┌─────────────────────────────────────────────────────────────────┐
│ 🏢 VENDORS                                        [+ Add Vendor]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ SYSCO (SYS)                              Delivers: Mon, Thu     │
│ ├─ Contact: John Smith | 555-123-4567                          │
│ ├─ Account: #12345678                                          │
│ └─ 45 products | Order by 2pm day before                       │
│                                                    [Edit] [View]│
│                                                                 │
│ US Foods (USF)                           Delivers: Tue, Fri     │
│ ├─ Contact: Jane Doe | 555-987-6543                            │
│ ├─ Account: #87654321                                          │
│ └─ 32 products | Order by 4pm 2 days before                    │
│                                                    [Edit] [View]│
│                                                                 │
│ Local Produce Co                         Delivers: Daily        │
│ ├─ Contact: Bob | 555-456-7890                                 │
│ └─ 12 products | Same day ordering OK                          │
│                                                    [Edit] [View]│
└─────────────────────────────────────────────────────────────────┘
```

### UI - Price Comparison
```
┌─────────────────────────────────────────────────────────────────┐
│ CHICKEN WINGS - Price Comparison                                │
├─────────────────────────────────────────────────────────────────┤
│ Vendor          Product              Price/lb    Last Updated   │
│ ─────────────────────────────────────────────────────────────── │
│ ★ Sysco         Wings, Fresh 40lb    $2.69       Feb 1, 2026   │
│   US Foods      Chicken Wings 50lb   $2.75       Jan 28, 2026  │
│   Local Poultry Farm Fresh Wings     $2.45       Jan 15, 2026  │
│                                                                 │
│ ★ = Preferred vendor                                            │
│ Best price: Local Poultry (-8.9% vs preferred)                 │
└─────────────────────────────────────────────────────────────────┘
```

### API Endpoints
- `GET /api/vendors` - List vendors
- `POST /api/vendors` - Create vendor
- `GET /api/vendors/[id]` - Get vendor details
- `PUT /api/vendors/[id]` - Update vendor
- `GET /api/vendors/[id]/products` - List vendor products
- `GET /api/ingredients/[id]/vendors` - Compare vendors for ingredient

### Route
`/inventory/vendors`

## Related Skills
- Skill 130: Historical Cost Tracking
- Skill 133: Quick Pricing Update
