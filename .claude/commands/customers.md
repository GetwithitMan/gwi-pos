# Customer Management

Track customer information, order history, preferences, and loyalty.

## Overview

Customer management maintains guest profiles with contact info, order history, preferences, and integration with loyalty programs and house accounts.

## Customer Records

### Create Customer
1. Go to `/customers`
2. Click "Add Customer"
3. Enter details:
   - First/Last Name
   - Phone
   - Email
   - Birthday (for promotions)
   - Notes/Preferences

### Quick Add from POS
1. During order, click "Add Customer"
2. Enter minimal info (name, phone)
3. Customer linked to order
4. Full profile completed later

## Customer Fields

| Field | Description |
|-------|-------------|
| firstName | First name |
| lastName | Last name |
| phone | Primary contact |
| email | For receipts, marketing |
| birthDate | Birthday promotions |
| notes | Preferences, allergies |
| isVIP | VIP status flag |
| isTaxExempt | Tax exempt flag |
| loyaltyPoints | Points balance |
| totalSpent | Lifetime spend |
| visitCount | Total visits |

## Customer Lookup

### Search Methods
- Phone number (most common)
- Name
- Email
- Customer ID

### At POS
1. Click customer icon
2. Search by phone or name
3. Select customer
4. Customer linked to order

## Order History

### View History
1. Open customer profile
2. Click "Order History"
3. See all past orders
4. Filter by date range

### History Shows
- Order date/time
- Items ordered
- Total spent
- Payment method
- Server name

## Preferences & Notes

### Dietary Restrictions
- Allergies (nuts, gluten, dairy)
- Dietary preferences (vegetarian, vegan)
- Shown on KDS tickets

### Seating Preferences
- Preferred table/section
- Indoor/outdoor preference
- Booth vs table

### Other Notes
- Favorite items
- Special occasions
- Service notes

## VIP Customers

### Mark as VIP
1. Open customer profile
2. Enable "VIP" toggle
3. VIP badge shows in POS

### VIP Benefits
- Priority seating
- Special pricing (if configured)
- Manager notification on arrival
- Highlighted in reservations

## House Accounts

Link customers to house accounts for credit purchasing:
1. Open customer profile
2. Click "Link House Account"
3. Set credit limit
4. Customer can charge to account

See `house-accounts.md` for full details.

## Loyalty Integration

Link customers to loyalty program:
- Earn points on purchases
- Redeem rewards
- Track tier status

See `loyalty-program.md` for full details.

## Marketing

### Email Marketing
- Opt-in status tracking
- Birthday emails
- Promotional campaigns

### SMS Marketing
- Opt-in required
- Reservation reminders
- Special offers

## Reports

### Customer Report
- Total customers
- New customers (period)
- Top spenders
- Visit frequency

### Lifetime Value
- Average spend per visit
- Total lifetime value
- Predicted future value

## API Endpoints

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
  "phone": "555-1234",
  "email": "john@example.com"
}
```

### Get Customer
```
GET /api/customers/[id]
```

### Update Customer
```
PUT /api/customers/[id]
{
  "notes": "Prefers booth seating",
  "isVIP": true
}
```

### Get Order History
```
GET /api/customers/[id]/orders
```

## Database Model

### Customer
```prisma
model Customer {
  id            String    @id
  locationId    String
  firstName     String
  lastName      String
  phone         String?
  email         String?
  birthDate     DateTime?
  notes         String?
  isVIP         Boolean   @default(false)
  isTaxExempt   Boolean   @default(false)
  loyaltyPoints Int       @default(0)
  totalSpent    Decimal   @default(0)
  visitCount    Int       @default(0)
  lastVisit     DateTime?
  createdAt     DateTime
  orders        Order[]
  houseAccount  HouseAccount?
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/customers/page.tsx` | Customer management |
| `src/app/api/customers/route.ts` | Customers CRUD |
| `src/components/customers/CustomerSearch.tsx` | Search component |
| `src/components/customers/CustomerProfile.tsx` | Profile display |
