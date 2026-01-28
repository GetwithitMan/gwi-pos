# House Accounts

Allow trusted customers to charge purchases to an account.

## Overview

House accounts enable:
- Charge purchases to account
- Set credit limits
- Track balance and history
- Generate invoices for payment

## Admin Management

Navigate to `/house-accounts` to manage.

### Creating an Account

1. Click "Add Account"
2. Enter account name
3. Set credit limit (0 = unlimited)
4. Set payment terms (e.g., Net 30)
5. Link to customer (optional)
6. Set status to Active

### Account Settings

| Field | Description |
|-------|-------------|
| Name | Company or person name |
| Credit Limit | Maximum balance allowed |
| Payment Terms | Days until due (30, 60, 90) |
| Customer | Linked customer record |
| Status | active, suspended, closed |

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/house-accounts` | List accounts |
| `POST /api/house-accounts` | Create account |
| `GET /api/house-accounts/[id]` | Get details |
| `PUT /api/house-accounts/[id]` | Update account |
| `POST /api/house-accounts/[id]/payment` | Record payment |

## Account Structure

```json
{
  "id": "ha_xxx",
  "name": "ABC Company",
  "creditLimit": 5000.00,
  "currentBalance": 1234.56,
  "paymentTerms": 30,
  "status": "active",
  "transactions": [...],
  "customerId": "cust_xxx"
}
```

## POS Charging

1. Complete order as normal
2. Select "House Account" payment
3. Search/select account
4. Verify credit available
5. Charge confirmed
6. Balance updated

### Credit Check

```typescript
availableCredit = creditLimit - currentBalance
// $5000 limit - $1234 balance = $3766 available
```

If charge exceeds available credit, payment blocked.

## Transaction Types

| Type | Description |
|------|-------------|
| `charge` | Purchase added to balance |
| `payment` | Payment reducing balance |
| `adjustment` | Manual balance change |
| `credit` | Credit/refund applied |

## Recording Payments

1. Open account in admin
2. Click "Record Payment"
3. Enter amount received
4. Select payment method
5. Balance reduced

## Invoicing

Generate invoices showing:
- All charges in period
- Payments received
- Current balance due
- Due date

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/house-accounts/page.tsx` | Admin UI |
| `src/app/api/house-accounts/route.ts` | API endpoints |

## Settings

Configure in `/settings`:
- Enable house accounts
- Default payment terms
- Require manager approval
- Auto-suspend threshold
