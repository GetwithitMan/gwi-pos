# Discounts & Coupons

Apply percentage or fixed discounts to orders and items.

## Overview

The discount system supports percentage and fixed amount discounts at the order or item level, with optional manager approval requirements.

## Discount Types

### Percentage Discount
- Reduces by percentage of subtotal
- Example: 10% off = $50 subtotal becomes $45

### Fixed Amount Discount
- Reduces by specific dollar amount
- Example: $5 off = $50 subtotal becomes $45

### Item vs Order Level

| Level | Applies To | Use Case |
|-------|------------|----------|
| Item | Single item | Happy hour item |
| Order | Entire order | Senior discount |

## Creating Discounts

### Admin Setup
1. Go to `/settings/discounts`
2. Click "Add Discount"
3. Configure:
   - Name (e.g., "Senior Discount")
   - Type (percentage or fixed)
   - Value (10% or $5.00)
   - Requires manager approval
   - Active status

### Discount Fields

| Field | Description |
|-------|-------------|
| name | Display name |
| type | percent or fixed |
| value | Amount or percentage |
| minOrderAmount | Minimum to apply |
| maxDiscountAmount | Cap on discount |
| requiresManagerApproval | Needs PIN |
| isActive | Available to use |

## Applying Discounts

### To Order
1. Click "Discount" button in order panel
2. Select discount from list
3. Enter reason (optional)
4. If manager required, enter manager PIN
5. Discount applied to order total

### To Item
1. Click item in order
2. Select "Discount"
3. Choose discount type
4. Enter amount/percentage
5. Discount applied to item only

### Quick Discounts
- Percentage buttons: 5%, 10%, 15%, 20%
- Custom entry option
- Manager can approve on-the-fly

## Coupons

### Create Coupon
1. Go to `/settings/coupons`
2. Click "Add Coupon"
3. Configure:
   - Code (e.g., "SAVE10")
   - Discount type and value
   - Valid dates
   - Usage limits

### Apply Coupon
1. Click "Coupon" in order panel
2. Enter coupon code
3. System validates:
   - Code exists
   - Not expired
   - Usage limit not reached
   - Minimum order met
4. Discount applied

### Coupon Fields

| Field | Description |
|-------|-------------|
| code | Unique coupon code |
| discountType | percent or fixed |
| discountValue | Amount |
| validFrom | Start date |
| validUntil | Expiration date |
| usageLimit | Max total uses |
| usageCount | Times used |
| minOrderAmount | Minimum to apply |
| isActive | Can be redeemed |

## Manager Approval

### When Required
- Discount marked as "requires approval"
- Discount over threshold (e.g., >20%)
- Custom discount entry

### Approval Flow
1. Server applies discount
2. Manager approval prompt appears
3. Manager enters PIN
4. Discount applied
5. Manager logged on transaction

## Restrictions

### Order Minimums
- Set minimum order amount
- Discount won't apply below minimum

### Maximum Discount
- Cap total discount amount
- Prevents excessive discounts

### Exclusions
- Certain items excluded
- Categories excluded
- Not combinable flag

## Reports

### Discount Report
- Total discounts given
- By discount type
- By employee
- By reason

### Coupon Report
- Redemptions by code
- Revenue impact
- Unused coupons

## API Endpoints

### List Discounts
```
GET /api/discounts?locationId=xxx
```

### Apply Discount to Order
```
POST /api/orders/[orderId]/discount
{
  "discountId": "xxx",
  "reason": "Birthday",
  "approvedBy": "manager-id"
}
```

### Apply Custom Discount
```
POST /api/orders/[orderId]/discount
{
  "type": "percent",
  "value": 15,
  "reason": "Complaint resolution",
  "approvedBy": "manager-id"
}
```

### Validate Coupon
```
GET /api/coupons/validate?code=SAVE10&orderId=xxx
```

### Redeem Coupon
```
POST /api/orders/[orderId]/coupon
{
  "code": "SAVE10"
}
```

## Database Models

### Discount
```prisma
model Discount {
  id                      String   @id
  locationId              String
  name                    String
  type                    String   // percent, fixed
  value                   Decimal
  minOrderAmount          Decimal?
  maxDiscountAmount       Decimal?
  requiresManagerApproval Boolean  @default(false)
  isActive                Boolean  @default(true)
}
```

### Coupon
```prisma
model Coupon {
  id             String    @id
  locationId     String
  code           String    @unique
  discountType   String
  discountValue  Decimal
  validFrom      DateTime?
  validUntil     DateTime?
  usageLimit     Int?
  usageCount     Int       @default(0)
  minOrderAmount Decimal?
  isActive       Boolean   @default(true)
}
```

### OrderDiscount
```prisma
model OrderDiscount {
  id          String   @id
  orderId     String
  locationId  String
  discountId  String?
  couponId    String?
  type        String
  value       Decimal
  amount      Decimal  // Actual discount amount
  reason      String?
  approvedBy  String?
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/settings/discounts/page.tsx` | Discount management |
| `src/app/api/discounts/route.ts` | Discounts CRUD |
| `src/components/orders/DiscountModal.tsx` | Apply discount UI |
| `src/app/api/orders/[id]/discount/route.ts` | Apply discount API |
| `src/app/api/coupons/route.ts` | Coupons CRUD |
