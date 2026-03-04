# Feature: Upsell Prompts & Suggestions

## Status
`Schema Built` — Data models (`UpsellConfig`, `UpsellEvent`) exist in the database schema. No API routes, UI, or runtime trigger logic has been built. Full implementation pending a planning session.

## Summary
Intelligent upsell suggestions shown to servers when items are added to an order. Increases revenue per check by prompting servers at the right moment (item-level, category-level, or order-level triggers). Schema models were built as part of the infrastructure layer; the feature is not yet active.

## Data Models

**UpsellConfig** — defines a single upsell rule
```
id                   String    (cuid)
locationId           String    (FK → Location)

-- Trigger
triggerType          String    "item" | "category" | "order_condition"
triggerItemId        String?   (FK → MenuItem, for item-level trigger)
triggerCategoryId    String?   (FK → Category, for category-level trigger)
triggerCondition     Json?     Arbitrary condition (e.g., total threshold, item count)

-- Suggestion
suggestionType       String    "item" | "category" | "combo" | "upgrade"
suggestionItemId     String?   (FK → MenuItem)
suggestionCategoryId String?   (FK → Category)

-- Display
promptText           String    The text shown to the server
displayMode          String    "inline" | "popup" | "toast" (default: "inline")
showPrice            Boolean   Show suggested item price alongside prompt (default: true)

-- Timing
triggerOnAdd         Boolean   Fire when trigger item/category added (default: true)
triggerBeforeSend    Boolean   Fire before order is sent to kitchen (default: false)
triggerAtPayment     Boolean   Fire at payment step (default: false)

-- Status
isActive             Boolean   (default: true)
priority             Int       Higher priority fires first when multiple rules match (default: 0)

createdAt            DateTime
updatedAt            DateTime
deletedAt            DateTime? (soft delete)
syncedAt             DateTime?
```

Relations:
- `location` → Location
- `triggerItem` → MenuItem (via "TriggerItem" relation)
- `triggerCategory` → Category (via "UpsellTriggerCategory" relation)
- `suggestionItem` → MenuItem (via "SuggestionItem" relation)
- `suggestionCategory` → Category (via "UpsellSuggestionCategory" relation)
- `events` → UpsellEvent[]

---

**UpsellEvent** — records each time an upsell prompt was shown and what happened
```
id             String    (cuid)
locationId     String    (FK → Location)
upsellConfigId String    (FK → UpsellConfig)
orderId        String    (FK → Order)
employeeId     String    (FK → Employee)

wasShown       Boolean   (default: true)
wasAccepted    Boolean   (default: false)
wasDismissed   Boolean   (default: false)

addedAmount    Decimal?  Revenue added if accepted

createdAt      DateTime
updatedAt      DateTime
deletedAt      DateTime? (soft delete)
syncedAt       DateTime?
```

## Key Capabilities (from SPEC-58, not yet built)
- **Item-level prompts** — "Add bacon to this burger?" triggered on specific item add
- **Category-level prompts** — "Add a drink?" when a food item is added without a beverage
- **Order-level prompts** — "Suggest dessert?" when check total approaches close
- **Display modes:** inline (non-intrusive), popup (prominent), toast notification
- **"Almost there" hints** — show when N items or $X away from a bundle/discount
- Margin-based suggestion prioritization (suggest high-margin items first)
- Performance dashboard with success rates by item, server, and time period
- Leaderboard capability for server upsell contests

## Dependencies (anticipated)
- **Menu** — upsell rules reference menu items and categories (FKs exist in schema)
- **Orders** — triggered on order mutations; `UpsellEvent.orderId` links to order
- **Reports** — upsell performance metrics via `UpsellEvent` aggregation
- **Employees** — per-server performance tracking via `UpsellEvent.employeeId`
- **Settings** — enable/disable per location

## SPEC Document
`docs/skills/SPEC-58-UPSELL-PROMPTS.md`

*Last updated: 2026-03-03*
