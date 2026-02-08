# 17 - Loyalty

**Status:** Planning
**Priority:** Medium
**Dependencies:** 04-Order-Management, 05-Employees-Roles

---

## Overview

The Loyalty skill manages customer loyalty programs including points earning, rewards redemption, membership tiers, and customer engagement. Can be built in-house or integrate with third-party loyalty platforms.

**Primary Goal:** Increase customer retention and lifetime value through a compelling rewards program.

---

## User Stories

### As a Customer...
- I want to earn points on my purchases
- I want to see my points balance easily
- I want to redeem rewards without hassle
- I want to know what rewards I'm close to earning

### As a Server...
- I want to quickly look up a customer's loyalty account
- I want to apply rewards at checkout
- I want to sign up new members easily

### As a Manager...
- I want to see loyalty program performance
- I want to create compelling rewards
- I want to segment and communicate with members

---

## Features

### Member Management

#### Sign Up
- [ ] Phone number lookup
- [ ] Email sign up
- [ ] In-app registration
- [ ] Quick sign up at POS
- [ ] QR code sign up

#### Member Profile
- [ ] Name, email, phone
- [ ] Birthday (for rewards)
- [ ] Preferences
- [ ] Visit history
- [ ] Points balance
- [ ] Tier status

#### Member Lookup
- [ ] Phone number search
- [ ] Email search
- [ ] Name search
- [ ] Member ID/card scan
- [ ] App QR code scan

### Points System

#### Earning Points
```yaml
earning_rules:
  - type: "spend"
    value: 1  # Points per dollar
    applies_to: "all"

  - type: "visit"
    value: 50  # Bonus points per visit
    minimum_spend: 10.00

  - type: "item"
    item_category: "appetizers"
    multiplier: 2  # 2x points on apps

  - type: "birthday"
    value: 500  # Birthday bonus
```

#### Point Calculations
- [ ] Points per dollar spent
- [ ] Bonus points per visit
- [ ] Multiplier days/items
- [ ] Birthday bonuses
- [ ] Referral bonuses

#### Point Rules
- [ ] Earn on subtotal vs total
- [ ] Exclude certain items
- [ ] Exclude discounted items
- [ ] Points expiration

### Rewards

#### Reward Types
- [ ] **Free Item:** Redeem points for menu item
- [ ] **Discount:** % or $ off
- [ ] **Points:** Bonus points
- [ ] **Experience:** Special perks

#### Reward Configuration
```yaml
rewards:
  - name: "Free Appetizer"
    points_required: 500
    type: "free_item"
    item_category: "appetizers"
    max_value: 15.00

  - name: "$10 Off"
    points_required: 750
    type: "discount"
    discount_type: "amount"
    discount_value: 10.00

  - name: "Free Entree"
    points_required: 1500
    type: "free_item"
    item_category: "entrees"
    max_value: 30.00
```

#### Reward Rules
- [ ] One reward per visit
- [ ] Combine with other offers
- [ ] Blackout dates
- [ ] Item restrictions

### Tier System

#### Tier Levels
```yaml
tiers:
  - name: "Bronze"
    points_required: 0
    earn_multiplier: 1.0
    perks: []

  - name: "Silver"
    points_required: 1000
    earn_multiplier: 1.25
    perks: ["priority_seating"]

  - name: "Gold"
    points_required: 5000
    earn_multiplier: 1.5
    perks: ["priority_seating", "birthday_reward", "exclusive_offers"]

  - name: "Platinum"
    points_required: 15000
    earn_multiplier: 2.0
    perks: ["all_gold_perks", "vip_events", "dedicated_host"]
```

#### Tier Benefits
- [ ] Earning multipliers
- [ ] Exclusive rewards
- [ ] Priority access
- [ ] Special perks

### Engagement

#### Communications
- [ ] Welcome email
- [ ] Points earned notification
- [ ] Reward available alert
- [ ] Birthday message
- [ ] Win-back campaigns

#### Campaigns
- [ ] Double points days
- [ ] Limited time rewards
- [ ] Bonus point challenges
- [ ] Referral programs

### Integration

#### POS Integration
- [ ] Lookup during checkout
- [ ] Auto-apply member pricing
- [ ] Redeem rewards
- [ ] Show points earned

#### App/Web Integration
- [ ] Member portal
- [ ] Mobile wallet
- [ ] Online ordering integration

---

## UI/UX Specifications

### Member Lookup at POS

```
+------------------------------------------------------------------+
| LOYALTY MEMBER                                    [+ New Member] |
+------------------------------------------------------------------+
| Search: [(555) 123-4567_____________]              [Search]      |
+------------------------------------------------------------------+
|                                                                  |
| MEMBER FOUND:                                                    |
| +-------------------------------------------------------------+ |
| | John Smith                              GOLD MEMBER          | |
| | john.smith@email.com                                         | |
| | Member since: Jan 2024                                       | |
| |                                                              | |
| | Points Balance: 2,340 pts                                    | |
| | Lifetime Points: 8,750 pts                                   | |
| |                                                              | |
| | AVAILABLE REWARDS:                                           | |
| | [🎁 Free Appetizer (500 pts)]  [💰 $10 Off (750 pts)]        | |
| |                                                              | |
| | [Apply to Check]              [View History]                 | |
| +-------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

### Redeem Reward Modal

```
+------------------------------------------------------------------+
| REDEEM REWARD                                         [Cancel]   |
+------------------------------------------------------------------+
| Member: John Smith                                               |
| Points: 2,340                                                    |
|                                                                  |
| SELECT REWARD:                                                   |
| +-------------------------------------------------------------+ |
| | (•) Free Appetizer - 500 pts                                 | |
| |     Choose any appetizer up to $15                           | |
| |                                                              | |
| | ( ) $10 Off - 750 pts                                        | |
| |     $10 off your check                                       | |
| |                                                              | |
| | ( ) Free Entree - 1,500 pts                                  | |
| |     Choose any entree up to $30                              | |
| +-------------------------------------------------------------+ |
|                                                                  |
| After redemption: 1,840 pts remaining                           |
|                                                                  |
| [Cancel]                                    [Redeem]             |
+------------------------------------------------------------------+
```

### Check with Loyalty

```
+------------------------------------------------------------------+
| CHECK #1234 - Table 12                                           |
+------------------------------------------------------------------+
| 🏆 GOLD MEMBER: John Smith (2,340 pts)                          |
+------------------------------------------------------------------+
| ITEMS                                                            |
| Wings                                $12.99                      |
| Ribeye                               $34.99                      |
| House Salad                           $8.99                      |
| 2x IPA                               $14.00                      |
|                                                                  |
| ─────────────────────────────────────                            |
| Subtotal                             $70.97                      |
| 🎁 Free Appetizer Reward            -$12.99                      |
| ─────────────────────────────────────                            |
| Subtotal after rewards               $57.98                      |
| Tax                                   $4.64                      |
| TOTAL                                $62.62                      |
|                                                                  |
| Points earned this visit: +58 (1.5x Gold)                       |
+------------------------------------------------------------------+
```

### Admin: Loyalty Dashboard

```
+------------------------------------------------------------------+
| LOYALTY PROGRAM                                                  |
+------------------------------------------------------------------+
| OVERVIEW (Last 30 Days)                                          |
| +------------+ +------------+ +------------+ +------------+      |
| | 1,234      | | 156        | | 45,670     | | $12,340    |      |
| | Members    | | New Signups| | Pts Earned | | Redemptions|      |
| +------------+ +------------+ +------------+ +------------+      |
|                                                                  |
| MEMBER DISTRIBUTION                                              |
| Bronze: ████████████████████████████████████░░░░ 2,456 (72%)    |
| Silver: ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   687 (20%)    |
| Gold:   ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   245 (7%)     |
| Platinum: █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    34 (1%)     |
|                                                                  |
| TOP REWARDS REDEEMED                                             |
| 1. Free Appetizer    - 234 redemptions                          |
| 2. $10 Off           - 189 redemptions                          |
| 3. Free Dessert      - 98 redemptions                           |
+------------------------------------------------------------------+
```

---

## Data Model

### Loyalty Members
```sql
loyalty_members {
  id: UUID PRIMARY KEY
  location_id: UUID (FK) -- Or organization for multi-location

  -- Identity
  phone: VARCHAR(20) UNIQUE
  email: VARCHAR(200) (nullable)
  first_name: VARCHAR(100)
  last_name: VARCHAR(100)

  -- Profile
  birthday: DATE (nullable)
  preferences: JSONB (nullable)

  -- Status
  tier_id: UUID (FK)
  current_points: INTEGER DEFAULT 0
  lifetime_points: INTEGER DEFAULT 0
  tier_points: INTEGER DEFAULT 0 -- Points counting toward next tier

  -- Engagement
  last_visit: DATE (nullable)
  visit_count: INTEGER DEFAULT 0

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Loyalty Tiers
```sql
loyalty_tiers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  points_required: INTEGER
  earn_multiplier: DECIMAL(3,2) DEFAULT 1.00

  perks: JSONB -- Array of perk codes
  color: VARCHAR(7) (nullable)

  sort_order: INTEGER

  created_at: TIMESTAMP
}
```

### Loyalty Rewards
```sql
loyalty_rewards {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT
  points_required: INTEGER

  reward_type: VARCHAR(50) (free_item, discount, bonus_points)

  -- For free_item
  item_category_id: UUID (FK, nullable)
  max_item_value: DECIMAL(10,2) (nullable)

  -- For discount
  discount_type: VARCHAR(50) (nullable)
  discount_value: DECIMAL(10,2) (nullable)

  -- For bonus_points
  bonus_points: INTEGER (nullable)

  -- Rules
  combinable: BOOLEAN DEFAULT false
  one_per_visit: BOOLEAN DEFAULT true

  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Points Transactions
```sql
loyalty_transactions {
  id: UUID PRIMARY KEY
  member_id: UUID (FK)
  location_id: UUID (FK)

  transaction_type: VARCHAR(50) (earn, redeem, expire, adjust, bonus)
  points: INTEGER -- Positive for earn, negative for redeem
  balance_after: INTEGER

  -- Reference
  order_id: UUID (FK, nullable)
  reward_id: UUID (FK, nullable)

  description: VARCHAR(200)

  created_by: UUID (FK, nullable)
  created_at: TIMESTAMP
}
```

### Redemptions
```sql
loyalty_redemptions {
  id: UUID PRIMARY KEY
  member_id: UUID (FK)
  reward_id: UUID (FK)
  order_id: UUID (FK)

  points_used: INTEGER
  value_redeemed: DECIMAL(10,2)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Members
```
GET    /api/loyalty/members
POST   /api/loyalty/members
GET    /api/loyalty/members/{id}
PUT    /api/loyalty/members/{id}
GET    /api/loyalty/members/lookup?phone={phone}
```

### Points
```
GET    /api/loyalty/members/{id}/points
POST   /api/loyalty/members/{id}/points/adjust
GET    /api/loyalty/members/{id}/transactions
```

### Rewards
```
GET    /api/loyalty/rewards
POST   /api/loyalty/rewards
PUT    /api/loyalty/rewards/{id}
GET    /api/loyalty/members/{id}/available-rewards
POST   /api/loyalty/members/{id}/redeem
```

### Order Integration
```
POST   /api/orders/{id}/loyalty/apply
POST   /api/orders/{id}/loyalty/redeem
GET    /api/orders/{id}/loyalty/earned
```

### Reporting
```
GET    /api/loyalty/reports/overview
GET    /api/loyalty/reports/redemptions
GET    /api/loyalty/reports/members
```

---

## Business Rules

1. **Points on Subtotal:** Points earned on pre-tax, pre-discount amount
2. **Tier Calculation:** Tier based on trailing 12-month spending
3. **Points Expiration:** Points expire after X months of inactivity
4. **One Reward Per Check:** Limit redemptions per transaction
5. **Birthday Reward:** Auto-grant birthday reward, valid for 30 days

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| Look up members | Yes | Yes | Yes |
| Sign up members | Yes | Yes | Yes |
| Apply rewards | Yes | Yes | Yes |
| Adjust points | No | Yes | Yes |
| Configure rewards | No | Yes | Yes |
| View reports | No | Yes | Yes |

---

## Configuration Options

```yaml
loyalty:
  earning:
    points_per_dollar: 1
    round_down: true
    exclude_discounted: false
    exclude_alcohol: false

  expiration:
    enabled: true
    months_inactive: 12

  rewards:
    one_per_visit: true
    combinable_with_promos: false

  tiers:
    enabled: true
    calculation_period_months: 12
```

---

## Open Questions

1. **Third-Party Integration:** Build in-house or integrate (Punchh, Thanx)?

2. **Mobile App:** Dedicated loyalty app or web-based?

3. **Multi-Location:** Share loyalty across locations?

4. **Referral Program:** Include referral bonuses?

5. **Gamification:** Add challenges, badges, streaks?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Point structure finalized
- [ ] Reward catalog designed

### Development
- [ ] Member management
- [ ] Points system
- [ ] Rewards engine
- [ ] POS integration
- [ ] Admin interface
- [ ] Reporting

---

*Last Updated: January 27, 2026*
