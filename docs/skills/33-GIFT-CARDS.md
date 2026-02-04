# 33 - Gift Cards

**Status:** Planning
**Priority:** High
**Dependencies:** 30-Tender-Types, 04-Order-Management

---

## Overview

The Gift Cards skill manages the full lifecycle of gift cards - selling, activating, checking balances, redeeming, and reloading. Supports both physical and digital gift cards.

**Primary Goal:** Provide a complete gift card solution that drives additional revenue and customer loyalty.

---

## User Stories

### As a Customer...
- I want to buy a gift card for someone
- I want to check my gift card balance
- I want to use my gift card to pay
- I want to receive a digital gift card via email

### As a Cashier...
- I want to easily sell and activate gift cards
- I want to check balances quickly
- I want to process gift card payments
- I want to reload existing cards

### As a Manager...
- I want to track gift card sales and redemptions
- I want to see outstanding liability
- I want to manage promotional gift cards

---

## Features

### Gift Card Types

#### Physical Cards
- [ ] Magnetic stripe cards
- [ ] Cards with PIN
- [ ] Barcode/QR cards
- [ ] Pre-denominated ($25, $50, $100)
- [ ] Variable amount

#### Digital/eGift Cards
- [ ] Email delivery
- [ ] SMS delivery
- [ ] Mobile wallet (Apple/Google)
- [ ] Printable PDF

### Selling Gift Cards

#### Sale Process
- [ ] Select gift card item
- [ ] Enter amount (or select preset)
- [ ] Optional: recipient email for eGift
- [ ] Process payment
- [ ] Activate card

#### Activation
- [ ] Swipe/scan physical card
- [ ] Generate digital card number
- [ ] Link to sale transaction
- [ ] Print/send confirmation

### Balance Operations

#### Check Balance
- [ ] Swipe/scan card
- [ ] Enter card number manually
- [ ] Display balance
- [ ] Show transaction history

#### Reload
- [ ] Add funds to existing card
- [ ] Minimum/maximum reload amounts
- [ ] Payment processing
- [ ] Updated balance confirmation

### Redemption

#### Payment Flow
- [ ] Select gift card as tender
- [ ] Swipe/scan or enter number
- [ ] Enter PIN (if required)
- [ ] Apply to check (full or partial)
- [ ] Handle split tenders

#### Partial Redemption
- [ ] Use available balance
- [ ] Remaining paid by other tender
- [ ] Show remaining gift card balance

### Digital Gift Cards

#### eGift Purchase
- [ ] Recipient email
- [ ] Recipient name
- [ ] Delivery date (immediate or scheduled)
- [ ] Personal message
- [ ] Gift wrapping graphics

#### eGift Delivery
- [ ] Branded email template
- [ ] Card number and PIN
- [ ] Balance amount
- [ ] Redemption instructions
- [ ] Barcode for in-store use

### Promotional Cards

#### Promo Card Types
- [ ] Bonus cards (buy $50, get $10 free)
- [ ] Marketing giveaways
- [ ] Compensation cards
- [ ] Loyalty rewards

#### Promo Rules
- [ ] Expiration dates
- [ ] Usage restrictions
- [ ] Single-use only
- [ ] Category restrictions

### Reporting

#### Gift Card Reports
- [ ] Sales summary
- [ ] Outstanding liability
- [ ] Redemption report
- [ ] Breakage analysis
- [ ] Card activity log

---

## UI/UX Specifications

### Sell Gift Card

```
+------------------------------------------------------------------+
| SELL GIFT CARD                                        [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| AMOUNT                                                           |
| [  $25  ] [  $50  ] [  $75  ] [ $100 ]  [Custom $_____]         |
|                                                                  |
| CARD TYPE                                                        |
| (•) Physical Card - Swipe to activate                           |
| ( ) Digital/eGift - Send via email                              |
|                                                                  |
| ─────────────────────────────────────────────────────────────── |
| For eGift:                                                       |
| Recipient Email: [_____________________________]                 |
| Recipient Name: [_____________________________]                  |
| Personal Message:                                                |
| [Happy Birthday! Enjoy dinner on me!________________]            |
| Delivery: (•) Now  ( ) Schedule: [Date/Time]                    |
| ─────────────────────────────────────────────────────────────── |
|                                                                  |
| SUMMARY                                                          |
| Gift Card Amount: $50.00                                        |
| Type: Physical                                                   |
|                                                                  |
| [Cancel]                              [Add to Order - $50.00]    |
+------------------------------------------------------------------+
```

### Check Balance / Redeem

```
+------------------------------------------------------------------+
| GIFT CARD                                                        |
+------------------------------------------------------------------+
|                                                                  |
| [Swipe Card] or enter number:                                   |
|                                                                  |
| Card Number: [1234-5678-9012-3456]                              |
| PIN (if required): [____]                                       |
|                                                                  |
|                           [Check Balance]                        |
+------------------------------------------------------------------+
|                                                                  |
| CARD DETAILS                                                     |
| ┌─────────────────────────────────────────────────────────────┐ |
| │ Card Number: ****3456                                        │ |
| │ Balance: $50.00                                              │ |
| │ Status: Active                                               │ |
| │ Last Used: Jan 15, 2026                                      │ |
| └─────────────────────────────────────────────────────────────┘ |
|                                                                  |
| Check Total: $67.50                                             |
| Apply Gift Card: [$50.00] (Available: $50.00)                   |
| Remaining to Pay: $17.50                                        |
|                                                                  |
| [Cancel]     [Reload Card]     [Apply $50.00 to Check]          |
+------------------------------------------------------------------+
```

### Gift Card Report

```
+------------------------------------------------------------------+
| GIFT CARD REPORT                                 Jan 2026        |
+------------------------------------------------------------------+
|                                                                  |
| SUMMARY                                                          |
| +------------+ +------------+ +------------+ +------------+      |
| | Sold       | | Redeemed   | | Reloaded   | | Outstanding|      |
| | $4,250.00  | | $3,125.00  | | $450.00    | | $8,750.00  |      |
| | 85 cards   | | 62 uses    | | 9 cards    | | (liability)|      |
| +------------+ +------------+ +------------+ +------------+      |
|                                                                  |
| ACTIVITY LOG                                                     |
| +----------------------------------------------------------+    |
| | Date     | Card     | Type     | Amount   | Balance     |    |
| +----------------------------------------------------------+    |
| | Jan 27   | ***3456  | Redeem   | -$50.00  | $0.00       |    |
| | Jan 27   | ***7890  | Sold     | +$100.00 | $100.00     |    |
| | Jan 26   | ***2345  | Reload   | +$25.00  | $75.00      |    |
| | Jan 26   | ***3456  | Redeem   | -$23.50  | $50.00      |    |
| +----------------------------------------------------------+    |
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### Gift Cards
```sql
gift_cards {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Card identification
  card_number: VARCHAR(20) UNIQUE
  card_pin: VARCHAR(10) (nullable, hashed)
  barcode: VARCHAR(50) (nullable)

  -- Type
  card_type: VARCHAR(50) (physical, digital, promotional)
  is_promotional: BOOLEAN DEFAULT false

  -- Value
  initial_value: DECIMAL(10,2)
  current_balance: DECIMAL(10,2)

  -- Status
  status: VARCHAR(50) (inactive, active, depleted, expired, cancelled)
  activated_at: TIMESTAMP (nullable)

  -- Expiration
  expires_at: TIMESTAMP (nullable)

  -- For promotional cards
  promo_campaign_id: UUID (FK, nullable)
  restrictions: JSONB (nullable)

  -- For eGift
  recipient_email: VARCHAR(200) (nullable)
  recipient_name: VARCHAR(200) (nullable)
  personal_message: TEXT (nullable)
  delivered_at: TIMESTAMP (nullable)

  -- Original sale
  sold_order_id: UUID (FK, nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Gift Card Transactions
```sql
gift_card_transactions {
  id: UUID PRIMARY KEY
  gift_card_id: UUID (FK)
  location_id: UUID (FK)

  transaction_type: VARCHAR(50) (activation, redemption, reload, adjustment, expiration)
  amount: DECIMAL(10,2) -- Positive for load, negative for redemption
  balance_before: DECIMAL(10,2)
  balance_after: DECIMAL(10,2)

  -- Reference
  order_id: UUID (FK, nullable)
  payment_id: UUID (FK, nullable)

  notes: TEXT (nullable)

  processed_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### Gift Card Settings
```sql
gift_card_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Amounts
  min_load_amount: DECIMAL(10,2) DEFAULT 10.00
  max_load_amount: DECIMAL(10,2) DEFAULT 500.00
  preset_amounts: DECIMAL[] DEFAULT [25, 50, 75, 100]

  -- PIN
  require_pin: BOOLEAN DEFAULT false
  pin_length: INTEGER DEFAULT 4

  -- Digital
  allow_egift: BOOLEAN DEFAULT true
  egift_email_template_id: UUID (FK, nullable)

  -- Expiration
  cards_expire: BOOLEAN DEFAULT false
  expiration_months: INTEGER (nullable)

  -- Promotional
  allow_promo_cards: BOOLEAN DEFAULT true

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Gift Card Operations
```
POST   /api/gift-cards/sell
POST   /api/gift-cards/{id}/activate
GET    /api/gift-cards/{number}/balance
POST   /api/gift-cards/{id}/reload
POST   /api/gift-cards/{id}/redeem
GET    /api/gift-cards/{id}/history
```

### Card Lookup
```
GET    /api/gift-cards/lookup?number={number}
GET    /api/gift-cards/lookup?barcode={barcode}
```

### eGift
```
POST   /api/gift-cards/egift
POST   /api/gift-cards/{id}/resend
```

### Promotional
```
POST   /api/gift-cards/promo
POST   /api/gift-cards/promo/bulk
```

### Reporting
```
GET    /api/reports/gift-cards/summary
GET    /api/reports/gift-cards/liability
GET    /api/reports/gift-cards/activity
```

---

## Business Rules

1. **Activation Required:** Cards must be activated before use
2. **Balance Validation:** Cannot redeem more than balance
3. **No Cash Back:** Gift cards don't give cash back
4. **Liability Tracking:** Outstanding balance is a liability
5. **Expiration Rules:** Honor state laws on expiration
6. **Breakage:** Unused balances eventually become revenue

---

## Permissions

| Action | Cashier | Manager | Admin |
|--------|---------|---------|-------|
| Sell gift cards | Yes | Yes | Yes |
| Check balance | Yes | Yes | Yes |
| Redeem | Yes | Yes | Yes |
| Reload | Yes | Yes | Yes |
| Issue promo cards | No | Yes | Yes |
| Adjust balance | No | Yes | Yes |
| View reports | No | Yes | Yes |
| Configure settings | No | No | Yes |

---

## Configuration Options

```yaml
gift_cards:
  amounts:
    minimum: 10.00
    maximum: 500.00
    presets: [25, 50, 75, 100]

  security:
    require_pin: false
    pin_length: 4

  digital:
    enabled: true
    allow_scheduling: true
    send_reminder: true

  expiration:
    enabled: false
    months: 24
    warn_days_before: 30

  promotional:
    enabled: true
    require_approval: true
```

---

*Last Updated: January 27, 2026*
