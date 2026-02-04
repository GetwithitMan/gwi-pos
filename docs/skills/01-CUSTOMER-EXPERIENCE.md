# 01 - Customer Experience

**Status:** Planning
**Priority:** High
**Dependencies:** 02-Operator-Experience, 06-Tipping

---

## Overview

The Customer Experience skill covers all customer-facing interfaces - the display they see during ordering and payment. This includes the secondary screen showing their order, tip selection, payment confirmation, and any idle/marketing displays.

**Primary Goal:** Create a beautiful, trustworthy interface that makes customers feel confident about their order and comfortable with tipping.

---

## User Stories

### As a Customer...
- I want to see items added to my order in real-time so I can verify accuracy
- I want clear tip options so I can quickly select without feeling pressured
- I want to see my total clearly before paying
- I want to choose how to receive my receipt (print, email, none)
- I want the interface to feel professional and trustworthy

### As a Restaurant Owner...
- I want my branding displayed on the customer screen
- I want to customize tip suggestion amounts
- I want to show promotions during idle time
- I want the display to encourage appropriate tipping

---

## Features

### Display Modes

#### Order Building Mode
- [ ] Shows items as they're added to the order
- [ ] Item name, modifiers, price per item
- [ ] Running subtotal
- [ ] Clear, large typography
- [ ] Smooth animations when items added/removed
- [ ] "Your Order" header with item count

#### Payment Mode
- [ ] Order summary (collapsible if many items)
- [ ] Subtotal, tax, total breakdown
- [ ] Tip selection interface
- [ ] Payment method indicator
- [ ] Signature capture (if required)
- [ ] Processing indicator

#### Receipt Mode
- [ ] "Thank You" message
- [ ] Receipt delivery options (Print / Email / Text / No Receipt)
- [ ] Email/phone input if selected
- [ ] Survey link option
- [ ] Return to idle after timeout

#### Idle/Marketing Mode
- [ ] Rotating promotional slides
- [ ] Brand logo/messaging
- [ ] Social media handles
- [ ] Daily specials
- [ ] Configurable slide duration
- [ ] Wake on activity

### Tip Selection Interface

**This is CRITICAL for the business - must be designed carefully**

#### Tip Options
- [ ] 3-4 preset percentage buttons (e.g., 18%, 20%, 22%, 25%)
- [ ] 3-4 preset dollar amount buttons (e.g., $2, $3, $5)
- [ ] Custom amount button (opens numpad)
- [ ] No Tip option (visible but not prominent)
- [ ] Pre-calculate amounts shown on buttons

#### Tip Display Strategies
- [ ] Percentage-first (show % with calculated $ below)
- [ ] Dollar-first (show $ with calculated % below)
- [ ] Percentage-only
- [ ] Dollar-only
- [ ] Configurable per location

#### Tip Psychology Features
- [ ] Default/highlighted option (configurable which one)
- [ ] "Most customers tip X" messaging (optional)
- [ ] Server name display (optional)
- [ ] Round-up option (round total to nearest dollar, difference as tip)

### Customization Options

#### Branding
- [ ] Logo upload (header position)
- [ ] Primary color (buttons, highlights)
- [ ] Secondary color (accents)
- [ ] Background color/image
- [ ] Font selection (from approved list)

#### Content
- [ ] Welcome message
- [ ] Thank you message
- [ ] Receipt prompt message
- [ ] Tip screen header text
- [ ] Custom footer text

#### Behavior
- [ ] Tip preset values
- [ ] Default tip selection
- [ ] Idle timeout duration
- [ ] Receipt default option
- [ ] Require signature above $X

---

## UI/UX Specifications

### Screen Layout - Order Building

```
+------------------------------------------+
|            [LOGO]                        |
|                                          |
|              Your Order                  |
|                                          |
|  +------------------------------------+  |
|  | Cheeseburger              $12.99   |  |
|  |   + Bacon, No Onion                |  |
|  |                                    |  |
|  | House Salad                 $8.99  |  |
|  |   + Ranch dressing                 |  |
|  |                                    |  |
|  | Draft Beer - IPA            $7.00  |  |
|  |                                    |  |
|  +------------------------------------+  |
|                                          |
|           ─────────────────              |
|           Subtotal    $28.98             |
|                                          |
+------------------------------------------+
```

### Screen Layout - Tip Selection

```
+------------------------------------------+
|            [LOGO]                        |
|                                          |
|           Add a Tip?                     |
|                                          |
|    +--------+  +--------+  +--------+    |
|    |  18%   |  |  20%   |  |  25%   |    |
|    | $5.22  |  | $5.80  |  | $7.25  |    |
|    +--------+  +--------+  +--------+    |
|                                          |
|    +--------+  +-------------------------+
|    | Custom |  |       No Tip           |
|    +--------+  +-------------------------+
|                                          |
|           ─────────────────              |
|           Subtotal      $28.98           |
|           Tax            $2.32           |
|           Tip            $5.80           |
|           ─────────────────              |
|           TOTAL         $37.10           |
|                                          |
+------------------------------------------+
```

### Design Requirements

- **Font Size:** Minimum 18px for body, 24px+ for totals
- **Touch Targets:** Minimum 48x48px for all interactive elements
- **Contrast:** WCAG AA compliant (4.5:1 minimum)
- **Colors:** Configurable, but validated for contrast
- **Animation:** Subtle, 200-300ms transitions
- **Responsiveness:** Support 7" to 15" displays

---

## Data Model

This skill primarily displays data from other skills. Minimal local storage.

### CustomerDisplayConfig
```
customer_display_config {
  id: UUID
  location_id: UUID (FK)

  // Branding
  logo_url: string
  primary_color: string (#hex)
  secondary_color: string (#hex)
  background_color: string (#hex)
  background_image_url: string (nullable)
  font_family: string

  // Tip Settings
  tip_preset_1: decimal (percentage, e.g., 0.18)
  tip_preset_2: decimal
  tip_preset_3: decimal
  tip_preset_4: decimal (nullable)
  default_tip_index: integer (1-4, nullable for no default)
  show_dollar_amounts: boolean
  show_percentages: boolean
  show_no_tip: boolean
  tip_screen_header: string

  // Messages
  welcome_message: string
  thank_you_message: string
  receipt_prompt_message: string

  // Behavior
  idle_timeout_seconds: integer
  receipt_default: enum (print, email, text, none, ask)
  signature_threshold: decimal (require sig above this amount)

  // Idle Slides
  idle_slides: JSON [{ image_url, duration_seconds, link_url }]

  created_at: timestamp
  updated_at: timestamp
}
```

---

## API Endpoints

### Configuration

```
GET  /api/locations/{id}/customer-display-config
PUT  /api/locations/{id}/customer-display-config
POST /api/locations/{id}/customer-display-config/logo
POST /api/locations/{id}/customer-display-config/slides
```

### Real-Time (WebSocket)

```
WS /ws/customer-display/{terminal_id}

Events received:
- order:updated { order_id, items, subtotal }
- order:cleared { }
- payment:started { total, tip_enabled }
- payment:tip-selected { tip_amount }
- payment:processing { }
- payment:completed { }
- payment:failed { error }
- display:idle { }
```

---

## Business Rules

1. **Tip Calculation:** Tips calculated on subtotal (pre-tax) by default, configurable to include tax
2. **No Tip Visibility:** "No Tip" option must always be available (legal requirement in some jurisdictions)
3. **Signature Threshold:** Configurable, typically $25-50
4. **Idle Timeout:** Display returns to idle mode after X seconds of inactivity (default: 30s)
5. **Data Privacy:** Customer email/phone used only for receipt, not stored permanently unless opted in

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| View display | - | - | - |
| Configure branding | No | Yes | Yes |
| Configure tip settings | No | Yes | Yes |
| Upload slides | No | Yes | Yes |
| View analytics | No | Yes | Yes |

*Note: Customer display itself has no login - controlled by operator terminal*

---

## Configuration Options

Located in: 09-FEATURES-CONFIG

```yaml
customer_display:
  enabled: true

  tip_settings:
    enabled: true
    presets: [0.18, 0.20, 0.22, 0.25]
    default_index: 2  # 20%
    calculate_on: "subtotal"  # or "total"
    show_no_tip: true
    show_custom: true

  receipt_settings:
    default: "ask"
    email_enabled: true
    sms_enabled: true
    print_enabled: true

  idle_settings:
    enabled: true
    timeout_seconds: 30
    slides_enabled: true
```

---

## Open Questions

1. **Split Payments:** How should the display handle split checks? Show each person's portion separately?

2. **Accessibility:** Do we need screen reader support for customer display? ADA considerations?

3. **Multiple Languages:** Support for Spanish/other languages?

4. **Loyalty Integration:** Show loyalty points earned on customer display?

5. **QR Code Receipts:** Option to show QR code that links to digital receipt?

6. **Feedback Collection:** Add quick rating (thumbs up/down or stars) after payment?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] UI mockups created
- [ ] Data model reviewed
- [ ] API contract defined

### Development
- [ ] Config admin interface
- [ ] Customer display components
- [ ] WebSocket integration
- [ ] Tip selection UI
- [ ] Receipt flow
- [ ] Idle/marketing mode

### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] User testing
- [ ] Accessibility audit

---

*Last Updated: January 27, 2026*
