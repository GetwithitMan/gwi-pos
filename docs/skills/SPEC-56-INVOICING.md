# 56 - Invoicing & B2B Billing

**Status:** Planning
**Priority:** Medium
**Dependencies:** 04-Order-Management, 30-Tender-Types, 08-Reporting

---

## Overview

The Invoicing skill enables B2B billing for catering orders, corporate accounts, and recurring customers. Generate professional invoices, track payment status, manage accounts receivable, and integrate with accounting systems. Supports deposit handling, partial payments, and payment terms.

**Primary Goal:** Professional invoice generation and accounts receivable management for business customers and large orders.

---

## User Stories

### As a Catering Manager...
- I want to create quotes and convert to invoices
- I want to collect deposits
- I want to track payment status
- I want to send invoices via email

### As a Corporate Client...
- I want itemized invoices for my company
- I want payment terms (Net 30)
- I want to pay by check or ACH
- I want monthly statements

### As an Accountant...
- I want to track accounts receivable
- I want aging reports
- I want to export to QuickBooks
- I want payment reconciliation

---

## Features

### Invoice Creation

#### Create from Order
```
+------------------------------------------------------------------+
| CREATE INVOICE                                                    |
+------------------------------------------------------------------+
|                                                                   |
| SOURCE: Catering Order #CAT-2026-0147                            |
| Event Date: February 15, 2026                                    |
| Customer: Acme Corporation                                       |
|                                                                   |
| INVOICE DETAILS                                                   |
| Invoice #: [INV-2026-0089_____] (Auto-generated)                 |
| Invoice Date: [01/27/2026]                                       |
| Due Date: [02/27/2026] (Net 30)                                  |
|                                                                   |
| BILLING ADDRESS                                                   |
| Acme Corporation                                                 |
| Attn: Accounts Payable                                           |
| 123 Business Park Dr, Suite 400                                  |
| Chicago, IL 60601                                                |
| [Change Address]                                                 |
|                                                                   |
| PAYMENT TERMS                                                     |
| [Net 30___________▼]                                             |
|                                                                   |
| OPTIONS                                                           |
| [✓] Include itemized breakdown                                   |
| [ ] Show individual item prices                                  |
| [✓] Include event details                                        |
| [ ] Add custom message                                           |
|                                                                   |
| [Cancel]                         [Preview Invoice]  [Create]     |
+------------------------------------------------------------------+
```

#### Invoice Preview
```
+------------------------------------------------------------------+
|                                                                   |
|                      ┌────────────────────────┐                  |
|                      │    GWI RESTAURANT      │                  |
|                      │    CATERING SERVICES   │                  |
|                      │   123 Main Street      │                  |
|                      │   City, State 12345    │                  |
|                      │   (555) 123-4567       │                  |
|                      └────────────────────────┘                  |
|                                                                   |
|                         I N V O I C E                            |
|                                                                   |
|  Invoice #: INV-2026-0089              Date: January 27, 2026   |
|  Order #: CAT-2026-0147                Due: February 27, 2026   |
|                                                                   |
|  ─────────────────────────────────────────────────────────────  |
|                                                                   |
|  BILL TO:                          EVENT DETAILS:                |
|  Acme Corporation                  Date: February 15, 2026       |
|  Attn: Accounts Payable            Time: 12:00 PM - 2:00 PM     |
|  123 Business Park Dr              Location: Your Office        |
|  Suite 400                         Guests: 50                    |
|  Chicago, IL 60601                                               |
|                                                                   |
|  ─────────────────────────────────────────────────────────────  |
|                                                                   |
|  DESCRIPTION                                    QTY    AMOUNT    |
|  ─────────────────────────────────────────────────────────────  |
|  Corporate Lunch Package                                         |
|    - Grilled Chicken Entree                     25    $437.50   |
|    - Salmon Entree                              15    $337.50   |
|    - Vegetarian Pasta                           10    $175.00   |
|    - Mixed Green Salad                          50    $200.00   |
|    - Assorted Desserts                          50    $250.00   |
|                                                                   |
|  Beverages                                                       |
|    - Iced Tea & Lemonade                        50    $100.00   |
|    - Coffee Service                              1     $75.00   |
|                                                                   |
|  Service                                                         |
|    - Setup & Breakdown                           1    $150.00   |
|    - Service Staff (2 @ 4hrs)                    8    $200.00   |
|                                                                   |
|  ─────────────────────────────────────────────────────────────  |
|                                          Subtotal:   $1,925.00   |
|                                          Tax (8%):     $154.00   |
|                                          ─────────────────────   |
|                                          TOTAL:      $2,079.00   |
|                                                                   |
|                                    Deposit Paid:      -$500.00   |
|                                    ─────────────────────────     |
|                                    BALANCE DUE:      $1,579.00   |
|                                                                   |
|  ─────────────────────────────────────────────────────────────  |
|                                                                   |
|  PAYMENT METHODS:                                                |
|  • Check payable to "GWI Restaurant"                            |
|  • ACH/Wire: Account details on request                         |
|  • Credit Card: Call (555) 123-4567                             |
|                                                                   |
|  Thank you for your business!                                    |
|                                                                   |
+------------------------------------------------------------------+
```

### Quote/Proposal

#### Quote Creation
```
+------------------------------------------------------------------+
| CREATE QUOTE                                                      |
+------------------------------------------------------------------+
|                                                                   |
| CUSTOMER                                                          |
| [Acme Corporation_________________________▼] [+ New Customer]    |
|                                                                   |
| QUOTE DETAILS                                                     |
| Quote #: [QT-2026-0034___] (Auto-generated)                      |
| Valid Until: [02/15/2026]                                        |
| Event Date: [02/15/2026]                                         |
| Guest Count: [50______]                                          |
|                                                                   |
| PACKAGES                                                          |
| +--------------------------------------------------------------+ |
| | Package                      | Per Person | Qty  | Total     | |
| +--------------------------------------------------------------+ |
| | Corporate Lunch Package      | $28.50     | 50   | $1,425.00 | |
| | Beverage Package             | $3.50      | 50   | $175.00   | |
| | Dessert Add-On               | $5.00      | 50   | $250.00   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ADD-ONS                                                           |
| +--------------------------------------------------------------+ |
| | Service                      | Rate       | Qty  | Total     | |
| +--------------------------------------------------------------+ |
| | [✓] Setup & Breakdown        | $150.00    | 1    | $150.00   | |
| | [✓] Service Staff            | $25.00/hr  | 8hrs | $200.00   | |
| | [ ] China & Linens           | $5.00/pp   | -    | -         | |
| | [ ] Delivery (10+ miles)     | $75.00     | -    | -         | |
| +--------------------------------------------------------------+ |
|                                                                   |
| PRICING SUMMARY                                                   |
| Subtotal:                                           $2,200.00    |
| Discount: [10___]% Reason: [Corporate Rate____]     -$220.00    |
| ─────────────────────────────────────────────────────────────   |
| Quote Total:                                        $1,980.00    |
| Est. Tax:                                             $158.40    |
| Est. Grand Total:                                   $2,138.40    |
|                                                                   |
| DEPOSIT REQUIRED                                                  |
| [25___]% = $534.60 due upon confirmation                        |
|                                                                   |
| [Save Draft]           [Preview]           [Send to Customer]    |
+------------------------------------------------------------------+
```

### Accounts Receivable

#### AR Dashboard
```
+------------------------------------------------------------------+
| ACCOUNTS RECEIVABLE                                               |
+------------------------------------------------------------------+
|                                                                   |
| SUMMARY                                                           |
| +------------------+ +------------------+ +------------------+    |
| | Total Outstanding| | Current          | | Overdue          |   |
| | $24,850.00       | | $18,200.00       | | $6,650.00        |   |
| | 12 invoices      | | 8 invoices       | | 4 invoices       |   |
| +------------------+ +------------------+ +------------------+    |
|                                                                   |
| AGING REPORT                                                      |
| +--------------------------------------------------------------+ |
| | Period         | Count | Amount      | % of Total            | |
| +--------------------------------------------------------------+ |
| | Current        | 8     | $18,200.00  | ████████████ 73%     | |
| | 1-30 Days      | 2     | $3,400.00   | ███ 14%              | |
| | 31-60 Days     | 1     | $1,850.00   | █ 7%                 | |
| | 61-90 Days     | 1     | $1,400.00   | █ 6%                 | |
| | 90+ Days       | 0     | $0.00       | 0%                   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| RECENT INVOICES                                                   |
| +--------------------------------------------------------------+ |
| | Invoice   | Customer        | Amount   | Due       | Status   | |
| +--------------------------------------------------------------+ |
| | INV-0089  | Acme Corp       | $1,579   | Feb 27    | Current  | |
| | INV-0088  | Tech Solutions  | $2,340   | Feb 20    | Current  | |
| | INV-0087  | City Hospital   | $4,200   | Feb 15    | Current  | |
| | INV-0082  | Law Firm LLP    | $1,850   | Jan 15    | 🔴 45 days| |
| | INV-0079  | Marketing Inc   | $1,400   | Dec 28    | 🔴 60 days| |
| +--------------------------------------------------------------+ |
|                                                                   |
| [View All Invoices]  [Send Reminders]  [Export to Accounting]    |
+------------------------------------------------------------------+
```

### Corporate Accounts

#### Account Management
```
+------------------------------------------------------------------+
| CORPORATE ACCOUNT: Acme Corporation                               |
+------------------------------------------------------------------+
|                                                                   |
| ACCOUNT INFO                                                      |
| Account #: CORP-0045                                             |
| Since: March 2024                                                |
| Credit Limit: $10,000.00                                         |
| Available Credit: $7,500.00                                      |
| Payment Terms: Net 30                                            |
|                                                                   |
| CONTACTS                                                          |
| Primary: John Smith (john@acme.com) - 555-123-4567              |
| Billing: AP Department (ap@acme.com) - 555-123-4568             |
|                                                                   |
| BILLING ADDRESS                                                   |
| 123 Business Park Dr, Suite 400                                  |
| Chicago, IL 60601                                                |
|                                                                   |
| ACCOUNT BALANCE                                                   |
| +--------------------------------------------------------------+ |
| | Outstanding Invoices                              $2,500.00   | |
| | Pending Orders                                    $1,200.00   | |
| | ─────────────────────────────────────────────────────────    | |
| | Total Exposure                                    $3,700.00   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| ORDER HISTORY                                                     |
| +--------------------------------------------------------------+ |
| | Date       | Order Type  | Amount   | Status                 | |
| +--------------------------------------------------------------+ |
| | 01/27/26   | Catering    | $2,079   | Invoice Sent           | |
| | 01/15/26   | Catering    | $1,450   | Paid                   | |
| | 12/20/25   | Catering    | $3,200   | Paid                   | |
| | 12/05/25   | In-House    | $421     | Paid                   | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Edit Account]  [New Order]  [Send Statement]  [View Invoices]   |
+------------------------------------------------------------------+
```

### Deposits & Payments

#### Deposit Tracking
```yaml
deposit_settings:
  catering:
    require_deposit: true
    deposit_percent: 25
    deposit_due: "on_confirmation"
    final_payment_due: "event_date"

  large_party:
    threshold: 20  # guests
    require_deposit: true
    deposit_percent: 20

  private_event:
    require_deposit: true
    deposit_amount: 500  # Fixed amount
```

#### Payment Recording
```
+------------------------------------------------------------------+
| RECORD PAYMENT - INV-2026-0089                                    |
+------------------------------------------------------------------+
|                                                                   |
| INVOICE DETAILS                                                   |
| Customer: Acme Corporation                                       |
| Invoice Amount: $2,079.00                                        |
| Previously Paid: $500.00 (Deposit)                               |
| Balance Due: $1,579.00                                           |
|                                                                   |
| PAYMENT                                                           |
| Amount: $[1,579.00______]                                        |
| Date: [01/27/2026]                                               |
|                                                                   |
| Payment Method:                                                   |
| ( ) Check                                                        |
| (•) ACH/Wire                                                     |
| ( ) Credit Card                                                  |
| ( ) Cash                                                         |
|                                                                   |
| Reference #: [ACH-78452190_______]                               |
|                                                                   |
| Notes:                                                            |
| [Payment received via ACH transfer___________________]           |
|                                                                   |
| [ ] Send payment confirmation email                              |
| [✓] Mark invoice as paid                                         |
|                                                                   |
| [Cancel]                              [Record Payment]           |
+------------------------------------------------------------------+
```

### Statements

#### Monthly Statement
```
+------------------------------------------------------------------+
|                                                                   |
|                      STATEMENT OF ACCOUNT                        |
|                                                                   |
|                      GWI Restaurant                              |
|                      123 Main Street                             |
|                      City, State 12345                           |
|                                                                   |
|  ─────────────────────────────────────────────────────────────  |
|                                                                   |
|  TO: Acme Corporation                Statement Date: Jan 31, 2026|
|      123 Business Park Dr            Account #: CORP-0045       |
|      Suite 400                        Payment Terms: Net 30      |
|      Chicago, IL 60601                                           |
|                                                                   |
|  ─────────────────────────────────────────────────────────────  |
|                                                                   |
|  DATE       DESCRIPTION              CHARGES    PAYMENTS  BALANCE|
|  ─────────────────────────────────────────────────────────────  |
|  Dec 31     Balance Forward                              $1,450.00|
|  Jan 05     Payment - Thank You                 $1,450   $0.00   |
|  Jan 15     INV-0087 - Catering     $4,200               $4,200.00|
|  Jan 20     Deposit - CAT-0147      $500                 $3,700.00|
|  Jan 27     INV-0089 - Catering     $1,579               $5,279.00|
|                                                                   |
|  ─────────────────────────────────────────────────────────────  |
|                                                                   |
|  AGING SUMMARY                                                    |
|  Current:        $5,279.00                                       |
|  1-30 Days:      $0.00                                           |
|  31-60 Days:     $0.00                                           |
|  Over 60 Days:   $0.00                                           |
|  ─────────────────────────────────────────────                   |
|  TOTAL DUE:      $5,279.00                                       |
|                                                                   |
|  Please remit payment to address above.                          |
|  Questions? Contact ar@gwirestaurant.com                         |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Data Model

### Invoices
```sql
invoices {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Identity
  invoice_number: VARCHAR(50) UNIQUE
  order_id: UUID (FK, nullable)
  quote_id: UUID (FK, nullable)

  -- Customer
  customer_id: UUID (FK)
  billing_address: JSONB

  -- Dates
  invoice_date: DATE
  due_date: DATE
  event_date: DATE (nullable)

  -- Amounts
  subtotal: DECIMAL(10,2)
  discount_amount: DECIMAL(10,2) DEFAULT 0
  tax_amount: DECIMAL(10,2)
  total_amount: DECIMAL(10,2)
  deposit_amount: DECIMAL(10,2) DEFAULT 0
  balance_due: DECIMAL(10,2)

  -- Payment
  payment_terms: VARCHAR(50)
  status: VARCHAR(50)  -- draft, sent, viewed, partial, paid, overdue, void

  -- Communication
  sent_at: TIMESTAMP (nullable)
  viewed_at: TIMESTAMP (nullable)
  last_reminder_at: TIMESTAMP (nullable)

  notes: TEXT (nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Quotes
```sql
quotes {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  quote_number: VARCHAR(50) UNIQUE
  customer_id: UUID (FK)

  -- Validity
  quote_date: DATE
  valid_until: DATE
  event_date: DATE (nullable)

  -- Amounts
  subtotal: DECIMAL(10,2)
  discount_percent: DECIMAL(5,2) DEFAULT 0
  discount_amount: DECIMAL(10,2) DEFAULT 0
  estimated_tax: DECIMAL(10,2)
  total_amount: DECIMAL(10,2)

  -- Deposit
  deposit_required: BOOLEAN DEFAULT false
  deposit_percent: DECIMAL(5,2) (nullable)
  deposit_amount: DECIMAL(10,2) (nullable)

  -- Status
  status: VARCHAR(50)  -- draft, sent, viewed, accepted, declined, expired, converted

  -- Conversion
  converted_to_invoice_id: UUID (FK, nullable)
  converted_at: TIMESTAMP (nullable)

  created_by: UUID (FK)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Invoice Payments
```sql
invoice_payments {
  id: UUID PRIMARY KEY
  invoice_id: UUID (FK)

  amount: DECIMAL(10,2)
  payment_date: DATE
  payment_method: VARCHAR(50)
  reference_number: VARCHAR(100) (nullable)

  notes: TEXT (nullable)

  recorded_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### Corporate Accounts
```sql
corporate_accounts {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  account_number: VARCHAR(50) UNIQUE
  company_name: VARCHAR(200)

  -- Contacts
  primary_contact: JSONB
  billing_contact: JSONB

  -- Addresses
  billing_address: JSONB

  -- Terms
  credit_limit: DECIMAL(10,2)
  payment_terms: VARCHAR(50) DEFAULT 'net_30'

  -- Status
  status: VARCHAR(50)  -- active, suspended, closed
  is_tax_exempt: BOOLEAN DEFAULT false
  tax_exempt_id: VARCHAR(100) (nullable)

  notes: TEXT (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Invoices
```
GET    /api/invoices
GET    /api/invoices/{id}
POST   /api/invoices
PUT    /api/invoices/{id}
DELETE /api/invoices/{id}
POST   /api/invoices/{id}/send
POST   /api/invoices/{id}/void
GET    /api/invoices/{id}/pdf
```

### Quotes
```
GET    /api/quotes
GET    /api/quotes/{id}
POST   /api/quotes
PUT    /api/quotes/{id}
DELETE /api/quotes/{id}
POST   /api/quotes/{id}/send
POST   /api/quotes/{id}/convert
GET    /api/quotes/{id}/pdf
```

### Payments
```
GET    /api/invoices/{id}/payments
POST   /api/invoices/{id}/payments
DELETE /api/invoice-payments/{id}
```

### Corporate Accounts
```
GET    /api/corporate-accounts
GET    /api/corporate-accounts/{id}
POST   /api/corporate-accounts
PUT    /api/corporate-accounts/{id}
GET    /api/corporate-accounts/{id}/statement
GET    /api/corporate-accounts/{id}/invoices
```

### Reports
```
GET    /api/invoices/aging
GET    /api/invoices/ar-summary
GET    /api/invoices/export
```

---

## Business Rules

1. **Sequential Numbering:** Invoice/quote numbers auto-increment
2. **Quote Expiration:** Quotes auto-expire after valid date
3. **Deposit Application:** Deposits applied to invoice balance
4. **Credit Limit:** Warn when corporate order exceeds available credit
5. **Payment Terms:** Due date calculated from invoice date + terms
6. **Overdue Status:** Auto-update status when past due

---

## Permissions

| Action | Server | Catering Mgr | Manager | Admin |
|--------|--------|--------------|---------|-------|
| Create quotes | No | Yes | Yes | Yes |
| Send quotes | No | Yes | Yes | Yes |
| Create invoices | No | Yes | Yes | Yes |
| Record payments | No | Yes | Yes | Yes |
| Void invoices | No | No | Yes | Yes |
| Manage corporate accts | No | No | Yes | Yes |
| View AR reports | No | Yes | Yes | Yes |
| Export to accounting | No | No | No | Yes |

---

## Configuration Options

```yaml
invoicing:
  numbering:
    invoice_prefix: "INV"
    quote_prefix: "QT"
    start_number: 1000

  defaults:
    payment_terms: "net_30"
    deposit_percent: 25

  reminders:
    send_reminders: true
    reminder_days: [7, 14, 30]  # Days before/after due
    auto_send: false

  statements:
    send_monthly: true
    send_day: 1  # Day of month

  integration:
    quickbooks_export: true
    xero_export: false

  templates:
    invoice_template: "professional"
    include_logo: true
    include_payment_instructions: true
```

---

*Last Updated: January 27, 2026*
