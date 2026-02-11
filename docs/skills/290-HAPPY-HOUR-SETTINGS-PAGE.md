# Skill 290: Happy Hour Settings Page

**Domain:** Settings, Menu
**Status:** DONE
**Date:** February 11, 2026
**Dependencies:** None

## Problem

Happy Hour configuration was embedded inline in the main `/settings` page (~200 lines of UI). This was cluttered and didn't scale well. Additionally, per-item happy hour fields in the Edit Item modal were redundant since happy hour is a location-wide setting.

## Solution

Extracted Happy Hour into its own dedicated settings page at `/settings/happy-hour`, linked from the Menu section of the settings navigation.

### Features

**Master Toggle:**
- Enable/disable Happy Hour globally

**Display Settings:**
- Custom display name (shown on POS badges, receipts, online ordering)
- Show badge on items toggle
- Show original price crossed out toggle

**Schedules (multiple):**
- Day-of-week selection with amber toggle buttons (Sun–Sat)
- Start/end time pickers
- Add/remove schedule blocks
- Default: Mon–Fri 4:00–6:00 PM

**Discount Configuration:**
- Type: Percentage off or Fixed amount off
- Applies to: All items, Specific categories, or Specific items
- Live preview: Shows example $10 item at discount price

### Settings Page Cleanup

- Replaced ~200 lines of inline Happy Hour UI with a compact link card
- Card shows current status (active name or "Not currently active")
- "Configure" button links to the dedicated page
- Removed 5 dead helper functions: `updateHappyHour`, `updateHappyHourSchedule`, `addHappyHourSchedule`, `removeHappyHourSchedule`, `toggleDayOfWeek`

## Files Created
- `src/app/(admin)/settings/happy-hour/page.tsx` — Dedicated Happy Hour settings page (~320 lines)

## Files Modified
- `src/components/admin/SettingsNav.tsx` — Added "Happy Hour" link to Menu section
- `src/app/(admin)/settings/page.tsx` — Replaced inline section with compact link card, removed dead code
- `src/components/menu/ItemSettingsModal.tsx` — Removed per-item happy hour fields (location-wide setting)

## Data Model

Uses existing `LocationSettings.happyHour` JSON structure:
```typescript
{
  enabled: boolean
  name: string
  showBadge: boolean
  showOriginalPrice: boolean
  discountType: 'percent' | 'fixed'
  discountValue: number
  appliesTo: 'all' | 'categories' | 'items'
  schedules: Array<{
    dayOfWeek: number[]
    startTime: string
    endTime: string
  }>
}
```

Reads/writes via `GET/PUT /api/settings`.
