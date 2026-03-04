# Feature: Online Ordering

## Status
`Active` — Core web ordering flow fully built (Skills 405-407). Settings admin UI complete. Third-party platform integrations (DoorDash, UberEats, Grubhub) and delivery order type not yet built.

## Summary
Customer-facing web ordering for pickup. Branded online store synced to POS menu. Orders flow into the POS as standard orders with Datacap PayAPI payment processing. Admin can control hours, menu visibility, order throttling, surcharges, tips, and notification destinations from 6 dedicated settings pages.

## UI Entry Points

### Admin Settings (authenticated)
- `/settings/online-ordering` — Overview: enable/disable toggle, ordering URL display, quick-links to sub-pages
- `/settings/online-ordering/hours` — Weekly schedule (Mon-Sun), per-day open/close times and closed toggle, "apply to all" quick-fill
- `/settings/online-ordering/menu` — Per-category and per-item `showOnline` toggle, per-item online price override, per-modifier-group `showOnline` toggle
- `/settings/online-ordering/notifications` — Notification email (every new order), notification phone via Twilio SMS (requires Twilio integration)
- `/settings/online-ordering/orders` — Prep time, order types (takeout; delivery/dine-in QR coming soon), special requests toggle, order throttling (max orders per time window), online surcharge (flat or percent), min/max order amounts
- `/settings/online-ordering/payments` — Tip suggestion percentages (3 configurable), default tip selection, require ZIP toggle, allow guest checkout toggle, require contact info for pickup toggle

### Public Customer-Facing
- `/order?locationId=xxx` — 3-step checkout flow: (1) browse menu by category, (2) cart + customer info entry, (3) Datacap hosted token card entry + order submit. Success screen shows order number and estimated prep time.

## API Endpoints

### Public (no authentication)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/online/menu` | Returns active online-orderable menu items grouped by category. Filters by `showOnline`, stock status, and `deletedAt`. Rate limited per IP+location. |
| POST | `/api/online/checkout` | Accepts cart + customer info + Datacap token. Validates prices server-side, charges card via PayAPI, creates order + payment record, emits order events. Rate limited per IP+location. |

### Admin Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/online-ordering` | Returns all online ordering settings for a location |
| PUT | `/api/settings/online-ordering` | Updates one or more settings fields (partial update via `settings.onlineOrdering` patch) |

### Internal (Mission Control push)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/internal/online-ordering/enabled` | Mission Control pushes enable/disable state to the POS. Requires `x-api-key` header (PROVISION_API_KEY). |

## Business Logic

### Hours Configuration
- Per-day schedule (Sunday-Saturday) stored as `{ day: number, open: string, close: string, closed: boolean }` array in location settings JSON
- When a day is marked closed, the public menu page shows "We're not accepting online orders right now."
- Quick-fill presets: "Open 11am-10pm daily" or "Closed all week"

### Menu Filtering
- Categories, items, and modifier groups each have a `showOnline` boolean field
- Items can have an `onlinePrice` override; if null, the POS price is used
- Out-of-stock items are displayed as "Sold out" and non-interactive
- Low-stock items are displayed with an amber "Low stock" badge
- Changes made in the Online Menu settings page use optimistic updates and call `/api/menu/categories/[id]` and `/api/menu/items/[id]` directly

### Notifications
- `notificationEmail`: receives an email for every new online order
- `notificationPhone`: receives an SMS via Twilio (requires Twilio integration configured under Settings > Integrations)
- Customer-facing confirmation email/SMS is not yet built (shown as disabled in UI)

### Order Configuration
- `prepTime` (1-120 minutes): shown to customer on success screen
- `orderTypes`: currently only "takeout" is active; delivery and dine-in QR are placeholders
- `allowSpecialRequests`: shows/hides the special instructions textarea
- `maxOrdersPerWindow` + `windowMinutes`: throttle accepts N orders per 15/30/60-minute window; blank = unlimited
- `surchargeName`, `surchargeType` (flat/percent), `surchargeAmount`: online surcharge applied at checkout
- `minOrderAmount` / `maxOrderAmount`: enforced at checkout; blank = no limit

### Payments / Tips
- `tipSuggestions`: 3 configurable percentage buttons shown on checkout
- `defaultTip`: which suggestion is pre-selected (or null for no default)
- `requireZip`: some card-not-present processors require ZIP for AVS
- `allowGuestCheckout`: if false, customers must create an account (account system not yet built)
- `requireContactForPickup`: requires phone or email for takeout orders

### Public Checkout Flow
1. Menu loads from `/api/online/menu` filtered by `showOnline` and current hours
2. Customer adds items with modifiers via item modal (required modifier groups validated before add)
3. Cart step: customer enters name (required), email (required), phone (optional), special notes (optional)
4. Payment step: Datacap Hosted Web Token iframe loads from CDN. On tokenization, `POST /api/online/checkout` is called.
5. Server re-prices all items from DB (client prices never trusted). Charges card via Datacap PayAPI. Creates Order + Payment record, emits order events.
6. Success screen shows order number and prep time estimate.

### Ordering URL
- Public URL pattern: `ordercontrolcenter.com/{ORDER_CODE}/{location-slug}`
- Order code derived deterministically from location slug (slug without hyphens, uppercased, 4-8 chars)
- Local dev preview: `/order?locationId={id}`

## Known Constraints
- **Payment gateway:** The public checkout uses **Datacap PayAPI** (Hosted Web Token), which is a card-not-present web tokenization product. This is distinct from the Datacap terminal readers used for in-person payments (Datacap card-present is not usable for web). The same Datacap account may support both flows, but the API credentials and integration paths differ.
- **Delivery not built:** Delivery order type is shown in UI but disabled ("Coming soon"). No driver management, delivery zone, or delivery fee logic exists.
- **Customer accounts not built:** Guest checkout is the only path; the `allowGuestCheckout: false` setting has no enforcement mechanism yet.
- **Customer confirmation email/SMS not built:** Only restaurant-side notifications are functional.
- **Third-party platforms not connected:** DoorDash, UberEats, Grubhub toggles exist in UI but are disabled; no webhook or integration logic is built.
- **Dine-in QR not built:** Order type shown as "Coming soon."

## Dependencies
- **Orders** — online orders become standard POS orders via the same order event system
- **Menu** — online menu is a filtered subset of POS menu (`showOnline` + `onlinePrice` fields)
- **Payments** — uses Datacap PayAPI (web token), not the Datacap terminal path
- **Settings** — all online ordering config stored in location settings JSON
- **Customers** — guest-only today; customer profiles not yet linked to online orders

## SPEC Document
`docs/skills/SPEC-23-ONLINE-ORDERING.md`

*Last updated: 2026-03-03*
