# Feature: Customers

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Customer profiles with contact info, tags (VIP/Regular/Banned), loyalty points, order history, and house account linking. Customers are PII — handle with care. House accounts provide credit-based billing for businesses and regular guests with aging reports and drawer integration.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, admin UI, POS lookup modal, house accounts | Full |
| `gwi-android-register` | Customer lookup on order | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Cloud sync | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/customers` | Managers (CUSTOMERS_VIEW) |
| POS Web | CustomerLookupModal (order panel) | Servers, Bartenders |
| Admin | `/house-accounts` | Managers (CUSTOMERS_HOUSE_ACCOUNTS) |
| Admin | `/reports/house-accounts` | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/customers/route.ts` | GET list, POST create |
| `src/app/api/customers/[id]/route.ts` | GET detail, PUT update, DELETE soft-delete |
| `src/app/api/orders/[id]/customer/route.ts` | GET/PUT link/unlink customer to order |
| `src/app/api/house-accounts/route.ts` | GET list, POST create |
| `src/app/api/house-accounts/[id]/route.ts` | GET detail, PUT update, DELETE |
| `src/app/api/house-accounts/[id]/payments/route.ts` | POST charge/payment transaction |
| `src/app/api/reports/house-accounts/route.ts` | GET aging report |
| `src/app/(admin)/customers/page.tsx` | Customer list + modals (1043 lines) |
| `src/app/(admin)/house-accounts/page.tsx` | House account management |
| `src/components/customers/CustomerLookupModal.tsx` | Search & quick-add for orders |
| `src/components/payment/steps/HouseAccountStep.tsx` | Payment method for house accounts |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/customers` | `CUSTOMERS_VIEW` | List customers with search/filter |
| `POST` | `/api/customers` | `CUSTOMERS_EDIT` | Create new customer |
| `GET` | `/api/customers/[id]` | `CUSTOMERS_VIEW` | Customer detail + order history + favorites |
| `PUT` | `/api/customers/[id]` | `CUSTOMERS_EDIT` | Update customer |
| `DELETE` | `/api/customers/[id]` | `CUSTOMERS_EDIT` | Soft delete (isActive=false) |
| `GET` | `/api/orders/[id]/customer` | Employee PIN | Get linked customer + loyalty settings |
| `PUT` | `/api/orders/[id]/customer` | Employee PIN | Link/unlink customer to order |
| `GET` | `/api/house-accounts` | `CUSTOMERS_HOUSE_ACCOUNTS` | List house accounts |
| `POST` | `/api/house-accounts` | `CUSTOMERS_HOUSE_ACCOUNTS` | Create house account |
| `GET` | `/api/house-accounts/[id]` | `CUSTOMERS_HOUSE_ACCOUNTS` | Account detail + transactions |
| `PUT` | `/api/house-accounts/[id]` | `CUSTOMERS_HOUSE_ACCOUNTS` | Update account |
| `DELETE` | `/api/house-accounts/[id]` | `CUSTOMERS_HOUSE_ACCOUNTS` | Close/delete (balance must be 0) |
| `POST` | `/api/house-accounts/[id]/payments` | `CUSTOMERS_HOUSE_ACCOUNTS` | Record charge/payment |
| `GET` | `/api/reports/house-accounts` | Manager | Aging report with buckets |

---

## Socket Events

None — customer operations do not emit socket events. Order linking emits `ORDER_METADATA_UPDATED` via order event system.

---

## Data Model

```
Customer {
  id              String
  locationId      String
  firstName       String
  lastName        String
  displayName     String?
  email           String?           // unique per location
  phone           String?           // unique per location
  notes           String?           // allergies, preferences
  tags            Json?             // VIP, Regular, Banned, etc.
  loyaltyPoints   Int               // default 0
  totalSpent      Decimal           // lifetime spend
  totalOrders     Int
  averageTicket   Decimal
  lastVisit       DateTime?
  marketingOptIn  Boolean
  birthday        DateTime?
  isActive        Boolean
  deletedAt       DateTime?
}

HouseAccount {
  id              String
  locationId      String
  name            String            // unique per location
  contactName     String?
  creditLimit     Decimal
  currentBalance  Decimal           // positive = owes money
  paymentTerms    Int               // days until due (default 30)
  status          Enum              // active | closed | suspended
  billingCycle    String            // monthly | weekly | on_demand
  taxExempt       Boolean
  customerId      String?           // optional link to Customer
  deletedAt       DateTime?
}

HouseAccountTransaction {
  id              String
  houseAccountId  String
  type            String            // charge | payment | adjustment | credit
  amount          Decimal
  balanceBefore   Decimal
  balanceAfter    Decimal
  orderId         String?
  employeeId      String?
  paymentMethod   String?           // check | cash | card
  referenceNumber String?
  dueDate         DateTime?
}
```

---

## Business Logic

### Customer Lookup Flow
1. Server taps "Customer" button on order panel
2. CustomerLookupModal opens with search input (min 2 chars)
3. Search across firstName, lastName, displayName, email, phone
4. Server selects customer → `PUT /api/orders/[id]/customer` links to order
5. Emits `ORDER_METADATA_UPDATED` event + socket broadcast
6. Loyalty settings returned (pointsPerDollar, redemption config)

### House Account Payment Flow
1. Cashier selects "House Account" as payment method
2. HouseAccountStep shows account search + balance + credit limit
3. Validates charge doesn't exceed credit limit (UI warning if it does)
4. Charge creates HouseAccountTransaction with balance tracking

### VIP Tier System
| Tier | Threshold |
|------|-----------|
| Silver | $500+ totalSpent |
| Gold | $2,000+ totalSpent |
| Platinum | $5,000+ totalSpent |

### Aging Report Buckets
| Bucket | Days Overdue |
|--------|-------------|
| Current | 0 days |
| 30 | 1-30 days |
| 60 | 31-60 days |
| 90 | 61-90 days |
| Over 90 | 90+ days |

### Edge Cases & Business Rules
- Email and phone unique per location (not globally)
- Banned customers show warning when linked to orders
- House account cannot be deleted if `currentBalance != 0`
- Loyalty points require `LOYALTY_POINTS` permission
- `requirePermission()` for read + write separately
- Customer data is PII — handle with care

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Orders | Customer assigned to order (customerId FK) |
| Payments | House accounts as payment method |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Settings | Customer features enabled/disabled |
| Roles | Customer read/write permissions gate access |
| Events | Tickets linked to customers |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Orders** — customer linking emits ORDER_METADATA_UPDATED event
- [ ] **Payments** — house account balance tracking integrity
- [ ] **Permissions** — CUSTOMERS_VIEW, CUSTOMERS_EDIT gates
- [ ] **Reports** — aging report calculations

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View customers | `customers.view` | Standard |
| Create/Edit customers | `customers.edit` | High |
| Gift cards | `customers.gift_cards` | High |
| House accounts | `customers.house_accounts` | High |
| Coupons | `customers.coupons` | High |
| Settings | `settings.customers` | Critical |

---

## Known Constraints & Limits
- Email + phone unique per location (not globally)
- Customer search returns max 50 results by default
- Order history paginated at 10 per page (max 50)
- Top 5 favorite items computed from order history

---

## Android-Specific Notes
- Customer lookup available via order screen
- Touch-friendly search with on-screen keyboard

---

## Related Docs
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Customers row
- **Skills:** Skill 51 (Customer Profiles), Skill 52 (Loyalty), Skill 228 (Card Token Loyalty)
- **House accounts:** `docs/domains/TABS-DOMAIN.md` (related flow)

---

*Last updated: 2026-03-03*
