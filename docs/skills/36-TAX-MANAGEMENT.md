# 36 - Tax Management

**Status:** Planning
**Priority:** High
**Dependencies:** 03-Menu-Programming, 04-Order-Management

---

## Overview

The Tax Management skill handles all tax configuration and calculation - multiple tax rates, tax-inclusive pricing, category-based taxes, tax exemptions, and tax reporting. Supports complex tax scenarios including state, county, city, and special district taxes.

**Primary Goal:** Accurate, compliant tax calculation with flexible configuration for various jurisdictions and scenarios.

---

## User Stories

### As a Manager...
- I want to configure tax rates for my location
- I want different taxes for different item categories
- I want to handle tax-exempt customers
- I want accurate tax reporting

### As an Accountant...
- I want detailed tax reports by category
- I want to reconcile taxes easily
- I want to track exemptions
- I want audit-ready documentation

### As a Cashier...
- I want to apply tax exemptions easily
- I want taxes calculated automatically
- I want clear tax display on receipts

---

## Features

### Tax Rate Configuration

#### Tax Types
- [ ] State tax
- [ ] County tax
- [ ] City/Municipal tax
- [ ] Special district tax
- [ ] Tourism/Hotel tax
- [ ] Alcohol tax
- [ ] Custom taxes

#### Tax Settings
```yaml
tax_rates:
  - name: "State Sales Tax"
    code: "STATE"
    rate: 6.25
    apply_to: "all"

  - name: "City Tax"
    code: "CITY"
    rate: 2.00
    apply_to: "all"

  - name: "Alcohol Tax"
    code: "ALC"
    rate: 3.00
    apply_to:
      categories: ["Beer", "Wine", "Spirits", "Cocktails"]

  - name: "Prepared Food Tax"
    code: "PREP"
    rate: 1.50
    apply_to:
      categories: ["Entrees", "Appetizers", "Desserts"]
    exclude:
      categories: ["Grocery", "Packaged Goods"]
```

### Category Tax Assignment

#### Taxable vs Non-Taxable
- [ ] Set categories as taxable/non-taxable
- [ ] Override at item level
- [ ] Multiple tax assignment
- [ ] Compound tax support

#### Category Configuration
```yaml
category_taxes:
  "Food":
    taxable: true
    taxes: ["STATE", "CITY", "PREP"]

  "Beverages":
    taxable: true
    taxes: ["STATE", "CITY"]

  "Alcohol":
    taxable: true
    taxes: ["STATE", "CITY", "ALC"]

  "Retail - Grocery":
    taxable: false
    taxes: []

  "Gift Cards":
    taxable: false
    taxes: []
```

### Tax Calculation

#### Calculation Methods
- [ ] Tax-exclusive (add tax to price)
- [ ] Tax-inclusive (tax included in price)
- [ ] Mixed (some inclusive, some exclusive)
- [ ] Compound taxes (tax on tax)

#### Rounding Rules
- [ ] Round per item
- [ ] Round per tax
- [ ] Round at subtotal
- [ ] Configurable rounding method

### Tax Exemptions

#### Exemption Types
- [ ] Non-profit organization
- [ ] Government/Military
- [ ] Resale certificate
- [ ] Diplomatic exemption
- [ ] Employee meals (if applicable)
- [ ] Custom exemption types

#### Exemption Process
- [ ] Enter exemption certificate
- [ ] Select exemption type
- [ ] Record customer info
- [ ] Partial exemptions (some taxes)
- [ ] Document storage

### Tax Holidays

#### Holiday Configuration
- [ ] State tax holidays
- [ ] Category restrictions
- [ ] Amount limits
- [ ] Automatic application

#### Tax Holiday Example
```yaml
tax_holidays:
  - name: "Back to School"
    start_date: "2026-08-01"
    end_date: "2026-08-03"
    exempt_taxes: ["STATE"]
    applies_to:
      categories: ["Clothing", "School Supplies"]
    max_item_price: 100.00
```

### Tax Reporting

#### Reports
- [ ] Tax collected by rate
- [ ] Tax by category
- [ ] Exemptions report
- [ ] Tax liability summary
- [ ] Audit detail report

---

## UI/UX Specifications

### Tax Configuration

```
+------------------------------------------------------------------+
| TAX MANAGEMENT                                          [+ Add Tax]|
+------------------------------------------------------------------+
|                                                                   |
| ACTIVE TAX RATES                                                  |
| +--------------------------------------------------------------+ |
| | Tax Name           | Code  | Rate   | Applies To     | Active| |
| +--------------------------------------------------------------+ |
| | State Sales Tax    | STATE | 6.25%  | All Items      | ✓     | |
| | City Tax           | CITY  | 2.00%  | All Items      | ✓     | |
| | Alcohol Tax        | ALC   | 3.00%  | Alcohol Only   | ✓     | |
| | Prepared Food Tax  | PREP  | 1.50%  | Prepared Food  | ✓     | |
| +--------------------------------------------------------------+ |
|                                                                   |
| COMBINED RATES BY CATEGORY                                        |
| +--------------------------------------------------------------+ |
| | Category           | Taxes Applied              | Total Rate  | |
| +--------------------------------------------------------------+ |
| | Food - Prepared    | STATE + CITY + PREP        | 9.75%       | |
| | Beverages          | STATE + CITY               | 8.25%       | |
| | Alcohol            | STATE + CITY + ALC         | 11.25%      | |
| | Retail - Grocery   | None (Non-taxable)         | 0.00%       | |
| | Gift Cards         | None (Non-taxable)         | 0.00%       | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Configure Categories]  [Tax Holidays]  [Exemption Types]        |
|                                                                   |
+------------------------------------------------------------------+
```

### Tax Rate Editor

```
+------------------------------------------------------------------+
| EDIT TAX RATE                                              [Save] |
+------------------------------------------------------------------+
|                                                                   |
| BASIC INFORMATION                                                 |
| Tax Name: [State Sales Tax________________]                       |
| Tax Code: [STATE____] (used in reports)                          |
| Rate: [6.25]%                                                    |
|                                                                   |
| TAX TYPE                                                          |
| (•) Standard Sales Tax                                           |
| ( ) Alcohol/Liquor Tax                                           |
| ( ) Prepared Food Tax                                            |
| ( ) Special District Tax                                         |
| ( ) Custom                                                        |
|                                                                   |
| APPLICATION                                                       |
| (•) Apply to all taxable items                                   |
| ( ) Apply to specific categories only                            |
|     [ ] Food - Prepared                                          |
|     [ ] Food - Packaged                                          |
|     [ ] Beverages                                                |
|     [ ] Alcohol                                                  |
|     [ ] Merchandise                                              |
|                                                                   |
| CALCULATION                                                       |
| [✓] Active                                                       |
| [ ] Compound (calculate on subtotal + other taxes)               |
| [ ] Tax-inclusive (price includes this tax)                      |
|                                                                   |
| [Cancel]                                              [Save Tax]  |
+------------------------------------------------------------------+
```

### Tax Exemption

```
+------------------------------------------------------------------+
| APPLY TAX EXEMPTION - Check #1234                                |
+------------------------------------------------------------------+
|                                                                   |
| EXEMPTION TYPE                                                    |
| +------------------+ +------------------+ +------------------+    |
| |  Non-Profit     | |  Government      | |  Resale         |    |
| |  Organization   | |  /Military       | |  Certificate    |    |
| +------------------+ +------------------+ +------------------+    |
| +------------------+ +------------------+                         |
| |  Diplomatic     | |  Other           |                         |
| +------------------+ +------------------+                         |
|                                                                   |
| CERTIFICATE INFORMATION                                           |
| Exemption Type: [Non-Profit Organization ▼]                      |
| Certificate #: [501c3-12345678______________]                    |
| Organization: [Local Food Bank______________]                    |
| Expiration: [12/31/2027]                                         |
|                                                                   |
| TAXES TO EXEMPT                                                   |
| [✓] State Sales Tax (6.25%)                                      |
| [✓] City Tax (2.00%)                                             |
| [✓] Prepared Food Tax (1.50%)                                    |
|                                                                   |
| Current Check: $125.00                                           |
| Tax Before Exemption: $12.19                                     |
| Tax After Exemption: $0.00                                       |
| Savings: $12.19                                                  |
|                                                                   |
| [Cancel]                              [Apply Exemption]          |
+------------------------------------------------------------------+
```

### Tax Report

```
+------------------------------------------------------------------+
| TAX REPORT                                    Jan 1-31, 2026     |
+------------------------------------------------------------------+
|                                                                   |
| SUMMARY                                                           |
| +----------------------+ +----------------------+                 |
| | Taxable Sales        | | Total Tax Collected  |                 |
| | $127,450.00          | | $10,847.25           |                 |
| +----------------------+ +----------------------+                 |
|                                                                   |
| TAX BREAKDOWN BY RATE                                             |
| +--------------------------------------------------------------+ |
| | Tax                | Taxable Sales  | Rate   | Tax Collected | |
| +--------------------------------------------------------------+ |
| | State Sales Tax    | $127,450.00    | 6.25%  | $7,965.63     | |
| | City Tax           | $127,450.00    | 2.00%  | $2,549.00     | |
| | Alcohol Tax        | $28,500.00     | 3.00%  | $855.00       | |
| | Prepared Food Tax  | $85,200.00     | 1.50%  | $1,278.00     | |
| +--------------------------------------------------------------+ |
| | TOTAL              |                |        | $10,847.25*   | |
| +--------------------------------------------------------------+ |
| * Note: Some items have multiple taxes applied                   |
|                                                                   |
| EXEMPTIONS                                                        |
| +--------------------------------------------------------------+ |
| | Type               | Orders | Exempt Amount | Tax Saved       | |
| +--------------------------------------------------------------+ |
| | Non-Profit         | 12     | $1,450.00     | $141.38         | |
| | Government         | 5      | $625.00       | $60.94          | |
| | Resale             | 3      | $2,100.00     | $204.75         | |
| +--------------------------------------------------------------+ |
|                                                                   |
| [Export CSV]  [Print Report]  [Detailed View]                    |
+------------------------------------------------------------------+
```

---

## Data Model

### Tax Rates
```sql
tax_rates {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  code: VARCHAR(20)
  description: TEXT (nullable)

  rate: DECIMAL(6,4) -- Supports 99.9999%
  tax_type: VARCHAR(50) (state, county, city, special, alcohol, prepared, custom)

  -- Application
  apply_to_all: BOOLEAN DEFAULT true
  is_compound: BOOLEAN DEFAULT false -- Tax on tax
  is_inclusive: BOOLEAN DEFAULT false -- Price includes tax

  -- Status
  is_active: BOOLEAN DEFAULT true
  effective_date: DATE (nullable)
  end_date: DATE (nullable)

  display_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Category Tax Assignments
```sql
category_tax_assignments {
  id: UUID PRIMARY KEY
  category_id: UUID (FK)
  tax_rate_id: UUID (FK)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP

  UNIQUE (category_id, tax_rate_id)
}
```

### Item Tax Overrides
```sql
item_tax_overrides {
  id: UUID PRIMARY KEY
  menu_item_id: UUID (FK)

  is_taxable: BOOLEAN
  tax_rate_ids: UUID[] (nullable) -- Specific taxes, null = inherit from category

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Tax Exemption Types
```sql
tax_exemption_types {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  code: VARCHAR(20)
  description: TEXT (nullable)

  -- What's exempt
  exempt_tax_ids: UUID[] -- Which taxes this exempts

  -- Requirements
  requires_certificate: BOOLEAN DEFAULT true
  requires_expiration: BOOLEAN DEFAULT false
  requires_approval: BOOLEAN DEFAULT false

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Tax Exemptions Applied
```sql
tax_exemptions {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)
  order_id: UUID (FK)
  exemption_type_id: UUID (FK)

  -- Certificate info
  certificate_number: VARCHAR(100) (nullable)
  organization_name: VARCHAR(200) (nullable)
  expiration_date: DATE (nullable)

  -- Amounts
  taxable_amount: DECIMAL(10,2)
  tax_exempted: DECIMAL(10,2)

  -- Audit
  applied_by: UUID (FK)
  approved_by: UUID (FK, nullable)

  notes: TEXT (nullable)

  created_at: TIMESTAMP
}
```

### Tax Holidays
```sql
tax_holidays {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)

  start_date: DATE
  end_date: DATE

  -- What's affected
  exempt_tax_ids: UUID[]
  category_ids: UUID[] (nullable) -- Null = all
  max_item_price: DECIMAL(10,2) (nullable)

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
}
```

### Order Taxes
```sql
order_taxes {
  id: UUID PRIMARY KEY
  order_id: UUID (FK)
  tax_rate_id: UUID (FK)

  taxable_amount: DECIMAL(10,2)
  tax_rate: DECIMAL(6,4) -- Rate at time of order
  tax_amount: DECIMAL(10,2)

  is_exempted: BOOLEAN DEFAULT false
  exemption_id: UUID (FK, nullable)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Tax Rates
```
GET    /api/tax-rates
POST   /api/tax-rates
PUT    /api/tax-rates/{id}
DELETE /api/tax-rates/{id}
GET    /api/tax-rates/effective -- Currently active rates
```

### Category Taxes
```
GET    /api/categories/{id}/taxes
PUT    /api/categories/{id}/taxes
GET    /api/categories/tax-summary
```

### Item Overrides
```
GET    /api/menu-items/{id}/tax-override
PUT    /api/menu-items/{id}/tax-override
DELETE /api/menu-items/{id}/tax-override
```

### Exemptions
```
GET    /api/tax-exemption-types
POST   /api/tax-exemption-types
PUT    /api/tax-exemption-types/{id}
POST   /api/orders/{id}/tax-exemption
GET    /api/tax-exemptions -- Report
```

### Tax Holidays
```
GET    /api/tax-holidays
POST   /api/tax-holidays
PUT    /api/tax-holidays/{id}
DELETE /api/tax-holidays/{id}
GET    /api/tax-holidays/active
```

### Calculation
```
POST   /api/calculate-tax
```

### Reports
```
GET    /api/reports/taxes/summary
GET    /api/reports/taxes/by-rate
GET    /api/reports/taxes/exemptions
GET    /api/reports/taxes/audit
```

---

## Business Rules

1. **Rate Precision:** Store rates to 4 decimal places for accuracy
2. **Rounding:** Round to nearest cent, half-up
3. **Compound Order:** Apply compound taxes after standard taxes
4. **Exemption Validation:** Verify certificate not expired
5. **Holiday Auto-Apply:** Automatically apply active tax holidays
6. **Audit Trail:** Log all rate changes and exemptions

---

## Permissions

| Action | Cashier | Manager | Admin |
|--------|---------|---------|-------|
| View tax rates | Yes | Yes | Yes |
| Apply exemptions | Limited | Yes | Yes |
| Configure tax rates | No | No | Yes |
| Create exemption types | No | No | Yes |
| Configure tax holidays | No | No | Yes |
| View tax reports | No | Yes | Yes |
| Override item taxes | No | Yes | Yes |

---

## Configuration Options

```yaml
taxes:
  calculation:
    rounding_method: "half_up"  # half_up, half_down, floor, ceil
    round_at: "subtotal"  # item, tax, subtotal
    precision: 2  # Decimal places

  display:
    show_tax_breakdown: true
    show_on_receipt: true
    group_taxes: false  # Show as single "Tax" line

  exemptions:
    require_manager_approval: false
    store_certificate_images: true
    validate_certificate_format: true

  holidays:
    auto_detect: true
    notify_staff: true

  defaults:
    new_categories_taxable: true
    new_items_inherit_category: true
```

---

## Compliance Notes

- Tax rates must match jurisdiction requirements
- Exemption certificates must be retained per state law
- Tax-inclusive pricing has disclosure requirements in some states
- Alcohol tax rates may require separate licensing
- Regular rate updates needed when jurisdictions change rates

---

*Last Updated: January 27, 2026*
