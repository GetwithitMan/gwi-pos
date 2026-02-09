# Database Migration: Add parentModifierId to OrderItemModifier

**Date:** February 7, 2026
**Related:** FIX-002 - API Responses Must Include Full Modifier Data
**Status:** ⚠️ REQUIRED - Blocking FIX-002 Completion

## Purpose

Add the `parentModifierId` field to the `OrderItemModifier` model to support hierarchical modifier tracking. This field allows the client to reconstruct the modifier tree structure from API responses.

## Current Schema

```prisma
model OrderItemModifier {
  id                     String   @id @default(cuid())
  locationId             String
  location               Location @relation(fields: [locationId], references: [id])
  orderItemId            String
  orderItem              OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)
  modifierId             String?
  modifier               Modifier? @relation(fields: [modifierId], references: [id])

  // Snapshot at time of sale
  name                   String
  price                  Decimal
  preModifier            String? // "no", "lite", "extra", "side"
  depth                  Int     @default(0) // Modifier hierarchy depth: 0=top, 1=child, 2=grandchild

  quantity               Int     @default(1)

  // Commission (Skill 29)
  commissionAmount       Decimal?

  // Linked Item Snapshot
  linkedMenuItemId       String?
  linkedMenuItemName     String?
  linkedMenuItemPrice    Decimal?

  // Liquor Builder - Spirit snapshot
  spiritTier             String? // 'well', 'call', 'premium', 'top_shelf'
  linkedBottleProductId  String? // Snapshot of bottle used for inventory

  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  // Sync fields
  deletedAt              DateTime?
  syncedAt               DateTime?

  @@index([locationId])
  @@index([orderItemId])
  @@index([spiritTier])
  @@index([linkedMenuItemId])
}
```

## Required Changes

### 1. Add Field to Schema

Edit `/prisma/schema.prisma`:

```prisma
model OrderItemModifier {
  id                     String   @id @default(cuid())
  locationId             String
  location               Location @relation(fields: [locationId], references: [id])
  orderItemId            String
  orderItem              OrderItem @relation(fields: [orderItemId], references: [id], onDelete: Cascade)
  modifierId             String?
  modifier               Modifier? @relation(fields: [modifierId], references: [id])

  // Snapshot at time of sale
  name                   String
  price                  Decimal
  preModifier            String? // "no", "lite", "extra", "side"
  depth                  Int     @default(0) // Modifier hierarchy depth: 0=top, 1=child, 2=grandchild
  parentModifierId       String? // ← ADD THIS: Links to parent modifier in same order item

  quantity               Int     @default(1)

  // Commission (Skill 29)
  commissionAmount       Decimal?

  // Linked Item Snapshot
  linkedMenuItemId       String?
  linkedMenuItemName     String?
  linkedMenuItemPrice    Decimal?

  // Liquor Builder - Spirit snapshot
  spiritTier             String? // 'well', 'call', 'premium', 'top_shelf'
  linkedBottleProductId  String? // Snapshot of bottle used for inventory

  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  // Sync fields
  deletedAt              DateTime?
  syncedAt               DateTime?

  @@index([locationId])
  @@index([orderItemId])
  @@index([spiritTier])
  @@index([linkedMenuItemId])
  @@index([parentModifierId])  // ← ADD THIS INDEX
}
```

### 2. Create Migration

```bash
cd "/Users/brianlewis/Documents/My websites/GWI POINT OF SALE"

# Generate migration
npx prisma migrate dev --name add-parent-modifier-id

# Alternatively, for production:
npx prisma migrate deploy
```

### 3. Update Response Mapper

Edit `/src/lib/api/order-response-mapper.ts`:

```typescript
modifiers: item.modifiers?.map((mod: any) => ({
  id: mod.id,
  modifierId: mod.modifierId,
  name: mod.name,
  price: Number(mod.price),
  quantity: mod.quantity,
  preModifier: mod.preModifier,
  depth: mod.depth ?? 0,
  spiritTier: mod.spiritTier,
  linkedBottleProductId: mod.linkedBottleProductId,
  parentModifierId: mod.parentModifierId,  // ← UNCOMMENT THIS LINE (line 29)
})) || [],
```

### 4. Update Order Creation Endpoints

#### File: `/src/app/api/orders/route.ts`

In the POST handler, update modifier creation (around line 138):

```typescript
modifiers: {
  create: item.modifiers.map(mod => ({
    locationId,
    modifierId: isValidModifierId(mod.modifierId) ? mod.modifierId : null,
    name: mod.name,
    price: mod.price,
    quantity: 1,
    preModifier: mod.preModifier || null,
    depth: mod.depth || 0,
    spiritTier: mod.spiritTier || null,
    linkedBottleProductId: mod.linkedBottleProductId || null,
    parentModifierId: mod.parentModifierId || null,  // ← ADD THIS LINE
  })),
},
```

#### File: `/src/app/api/orders/[id]/route.ts`

In the PUT handler, update modifier creation (around line 331):

```typescript
modifiers: {
  create: item.modifiers.map(mod => ({
    locationId: existingOrder.locationId,
    modifierId: isValidModifierId(mod.modifierId) ? mod.modifierId : null,
    name: mod.name,
    price: mod.price,
    quantity: 1,
    preModifier: mod.preModifier || null,
    depth: mod.depth || 0,
    spiritTier: mod.spiritTier || null,
    linkedBottleProductId: mod.linkedBottleProductId || null,
    parentModifierId: mod.parentModifierId || null,  // ← ADD THIS LINE
  })),
},
```

#### File: `/src/app/api/orders/[id]/items/route.ts`

In the POST handler, update modifier creation (around line 183):

```typescript
modifiers: {
  create: item.modifiers.map(mod => ({
    locationId: existingOrder.locationId,
    modifierId: isValidModifierId(mod.modifierId) ? mod.modifierId : null,
    name: mod.name,
    price: mod.price,
    quantity: 1,
    preModifier: mod.preModifier || null,
    depth: mod.depth || 0,
    spiritTier: mod.spiritTier || null,
    linkedBottleProductId: mod.linkedBottleProductId || null,
    parentModifierId: mod.parentModifierId || null,  // ← ADD THIS LINE
  })),
},
```

### 5. Update TypeScript Types (if needed)

Check if client-side types need updating. The UiModifier type from FIX-001 should already include this field, but verify in `/src/types/orders.ts` or similar.

## Verification Steps

After completing the migration:

1. **Check Schema:**
   ```bash
   npx prisma migrate status
   ```

2. **Regenerate Prisma Client:**
   ```bash
   npx prisma generate
   ```

3. **Test Order Creation:**
   ```bash
   # Create order with nested modifiers
   curl -X POST http://localhost:3000/api/orders \
     -H "Content-Type: application/json" \
     -d '{
       "employeeId": "...",
       "locationId": "...",
       "orderType": "dine_in",
       "items": [{
         "menuItemId": "...",
         "name": "House Salad",
         "price": 8.99,
         "quantity": 1,
         "modifiers": [
           {
             "modifierId": "ranch-dressing-id",
             "name": "Ranch Dressing",
             "price": 0,
             "depth": 0,
             "parentModifierId": null
           },
           {
             "modifierId": "extra-ranch-id",
             "name": "Extra Ranch",
             "price": 0.50,
             "depth": 1,
             "preModifier": "extra",
             "parentModifierId": "ranch-dressing-id"
           }
         ]
       }]
     }'
   ```

4. **Verify Response:**
   ```json
   {
     "items": [{
       "modifiers": [
         {
           "id": "...",
           "modifierId": "ranch-dressing-id",
           "name": "Ranch Dressing",
           "price": 0,
           "depth": 0,
           "parentModifierId": null  // ← Should be present
         },
         {
           "id": "...",
           "modifierId": "extra-ranch-id",
           "name": "Extra Ranch",
           "price": 0.50,
           "depth": 1,
           "preModifier": "extra",
           "parentModifierId": "..." // ← Should link to parent modifier
         }
       ]
     }]
   }
   ```

5. **Test All Endpoints:**
   - [ ] POST /api/orders (create order)
   - [ ] GET /api/orders/[id] (get order)
   - [ ] PUT /api/orders/[id] (update order)
   - [ ] POST /api/orders/[id]/items (append items)

## Rollback Plan

If issues arise:

```bash
# Roll back last migration
npx prisma migrate resolve --rolled-back add-parent-modifier-id

# Or revert to specific migration
npx prisma migrate resolve --rolled-back <migration-name>
```

## Data Integrity Notes

- **Existing Orders:** Old orders in the database will have `parentModifierId = null` for all modifiers
- **Backward Compatibility:** The field is nullable, so existing queries will continue to work
- **Client Handling:** Clients should treat `null` as "no parent" (top-level modifier)

## Related Issues

- **FIX-001:** Client-side modifier shape normalization (already expects this field)
- **FIX-002:** API response completeness (blocked by this migration)
- **Skill 123:** Menu Builder child modifiers (requires this field for hierarchy)

## Estimated Impact

- **Duration:** 5-10 minutes
- **Downtime:** None (schema change only, no data migration)
- **Risk:** Low (additive change, nullable field)
- **Testing:** 15-20 minutes to verify all endpoints

---

**Created:** February 7, 2026
**Last Updated:** February 7, 2026
**Status:** Ready to Execute
