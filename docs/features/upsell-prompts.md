# Feature: Upsell Prompts & Suggestions

## Status
`Active` — Full implementation: raw SQL tables, CRUD API, pure evaluation engine, POS banner UI, event tracking, analytics report, admin settings page.

## Summary
Intelligent upsell suggestions shown to servers when items are added to an order. Increases revenue per check by prompting servers at the right moment. Five trigger types: item-added, category-match, order-total threshold, time-of-day, and no-drink detection. Configurable per-location with conversion tracking.

## Data Models (Raw SQL — migration 031)

**UpsellRule** — defines a single upsell rule
```
id                  TEXT PK (gen_random_uuid)
locationId          TEXT FK → Location
name                TEXT
triggerType         TEXT    'item_added' | 'category_match' | 'order_total' | 'time_of_day' | 'no_drink'
triggerItemId       TEXT?   FK → MenuItem (for item_added trigger)
triggerCategoryId   TEXT?   FK → Category (for category_match trigger)
triggerMinTotal     DECIMAL(10,2)?  (for order_total trigger)
triggerTimeStart    TEXT?   HH:MM (for time_of_day trigger)
triggerTimeEnd      TEXT?   HH:MM (for time_of_day trigger)
triggerDaysOfWeek   INT[]?  0-6 Sun-Sat (for time_of_day trigger)
suggestItemId       TEXT?   FK → MenuItem
suggestCategoryId   TEXT?   FK → Category (picks first available item)
message             TEXT    Display message shown to server
priority            INT     Higher = shown first (default: 0)
isActive            BOOLEAN (default: true)
createdAt, updatedAt, deletedAt, syncedAt
```

**UpsellEvent** — tracks each upsell prompt interaction
```
id                  TEXT PK (gen_random_uuid)
locationId          TEXT FK → Location
upsellRuleId        TEXT FK → UpsellRule
orderId             TEXT
employeeId          TEXT?
suggestedItemId     TEXT?
suggestedItemName   TEXT?
suggestedItemPrice  DECIMAL(10,2)?
action              TEXT    'shown' | 'accepted' | 'dismissed'
addedAmount         DECIMAL(10,2)?  Revenue added (on accept)
createdAt, updatedAt, deletedAt, syncedAt
```

## Settings
`LocationSettings.upsellPrompts` — optional, defaults to disabled.
- `enabled` (boolean) — master toggle
- `maxPromptsPerOrder` (number) — max suggestions per order (default: 3)
- `showOnItemAdd` (boolean) — evaluate on item add (default: true)
- `showBeforeSend` (boolean) — evaluate before send (default: false)
- `dismissCooldownMinutes` (number) — cooldown before re-showing dismissed prompt (default: 0)

## Trigger Types
| Type | Fires When | Config Fields |
|------|-----------|---------------|
| `item_added` | Specific item is in the order | `triggerItemId` |
| `category_match` | Any item from a category is in the order | `triggerCategoryId` |
| `order_total` | Order subtotal >= threshold | `triggerMinTotal` |
| `time_of_day` | Current time within window (with day-of-week) | `triggerTimeStart`, `triggerTimeEnd`, `triggerDaysOfWeek` |
| `no_drink` | Order has food but no drinks/liquor | (none — auto-detected) |

## Code Locations

### API Routes
- `src/app/api/upsell-rules/route.ts` — GET (list), POST (create)
- `src/app/api/upsell-rules/[id]/route.ts` — GET, PUT, DELETE
- `src/app/api/orders/[id]/upsell-suggestions/route.ts` — GET (evaluate for order)
- `src/app/api/upsell-events/route.ts` — POST (record shown/accepted/dismissed)
- `src/app/api/reports/upsell-analytics/route.ts` — GET (per-rule and overall metrics)

### Engine
- `src/lib/upsell-engine.ts` — Pure evaluation function, no DB calls. Takes order items + rules + settings, returns sorted suggestions.

### UI
- `src/components/orders/UpsellPromptBanner.tsx` — Inline banner in OrderPanel (blue theme, matches ComboSuggestionBanner pattern)
- `src/app/(admin)/settings/upsell-rules/page.tsx` — Admin CRUD with settings, rule list, create/edit modal, inline analytics

### Settings
- `src/lib/settings.ts` — `UpsellPromptSettings` interface, `DEFAULT_UPSELL_PROMPTS`, added to `LocationSettings` and `mergeWithDefaults`

### Migration
- `scripts/migrations/031-upsell-rules.js` — Creates UpsellRule and UpsellEvent tables

## Business Logic
- Engine is pure (no side effects) — all data passed in by the suggestions API route
- Items already in the order are excluded from suggestions (no double-suggest)
- Dismissed and accepted rules are excluded for the current order
- Cooldown-based re-show when `dismissCooldownMinutes > 0`
- Priority-based sorting (higher first), limited to `maxPromptsPerOrder`
- Category suggestions pick the first available item not already in the order
- Time-of-day supports overnight windows (e.g., 22:00-02:00)
- Event tracking is fire-and-forget (non-blocking)

## Cross-Feature Dependencies
- **Menu** — rules reference MenuItem and Category
- **Orders** — suggestions evaluated per order; events link to orderId
- **Reports** — analytics endpoint aggregates UpsellEvent data
- **Employees** — events track employeeId for per-server analytics
- **Settings** — enable/disable via LocationSettings.upsellPrompts

## Known Constraints
- UpsellRule/UpsellEvent are raw SQL tables, not Prisma models — queries use `$queryRawUnsafe`
- No sync-config entry yet (would need to be added when Prisma models are created)
- `onAddUpsellItem` callback must be wired by the parent of OrderPanel (e.g., useOrderHandlers)
- The banner fetches suggestions debounced (600ms) to avoid rapid-fire on bulk item adds

*Last updated: 2026-03-10*
