# Menu Scheduling (Skill 40)

Schedule menu items and categories to be available at specific times.

## Overview

Menu scheduling controls when items appear on the POS based on day of week and time of day, enabling breakfast/lunch/dinner menus, happy hour items, and weekend specials.

## Schedule Types

### Item Availability
- Individual items shown/hidden by schedule
- Example: "Breakfast Burrito" only 6am-11am

### Category Availability
- Entire category shown/hidden
- Example: "Breakfast" category only until 11am

### Price Schedules
- Different prices at different times
- Example: Happy hour pricing 4pm-6pm
- See `happy-hour.md` for details

## Creating Schedules

### For Menu Item
1. Edit menu item
2. Click "Schedule" tab
3. Add availability windows:
   - Days of week
   - Start time
   - End time
4. Save

### For Category
1. Edit category
2. Click "Schedule" tab
3. Set availability windows
4. Items inherit category schedule

### Schedule Fields

| Field | Description |
|-------|-------------|
| days | Array of days (0=Sun, 6=Sat) |
| startTime | Start time (HH:MM) |
| endTime | End time (HH:MM) |
| isActive | Schedule enabled |

## Examples

### Breakfast Menu
```json
{
  "days": [0, 1, 2, 3, 4, 5, 6],
  "startTime": "06:00",
  "endTime": "11:00"
}
```

### Weekend Brunch
```json
{
  "days": [0, 6],
  "startTime": "10:00",
  "endTime": "15:00"
}
```

### Late Night Menu
```json
{
  "days": [4, 5, 6],
  "startTime": "22:00",
  "endTime": "02:00"
}
```

## How It Works

### On POS Load
1. System checks current day/time
2. Filters items by schedule
3. Only available items shown
4. Updates if schedule changes during shift

### Override
- Managers can show hidden items
- "Show all items" toggle
- Item marked as "off-menu" when ordered

## Schedule Conflicts

### Category vs Item
- Item schedule overrides category
- If category hidden, items hidden
- If category shown, item can still be hidden

### Multiple Schedules
- Items can have multiple windows
- Available if ANY window matches
- Example: Available 6am-11am AND 9pm-12am

## Reports

### Schedule Report
- Items by availability window
- Category schedules
- Upcoming schedule changes

## API Endpoints

### Get Item Schedule
```
GET /api/menu/items/[id]/schedule
```

### Set Item Schedule
```
PUT /api/menu/items/[id]/schedule
{
  "schedules": [
    {
      "days": [1, 2, 3, 4, 5],
      "startTime": "11:00",
      "endTime": "14:00"
    }
  ]
}
```

### Get Available Items
```
GET /api/menu/available?locationId=xxx&time=2026-01-28T14:30:00
```

## Database Fields

### MenuItem Schedule
```prisma
model MenuItem {
  // ... other fields
  schedules Json?  // Array of schedule objects
}
```

### Schedule Object
```typescript
interface Schedule {
  days: number[]      // 0-6 (Sun-Sat)
  startTime: string   // "HH:MM"
  endTime: string     // "HH:MM"
  isActive: boolean
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/menu/items/[id]/page.tsx` | Item edit with schedule |
| `src/components/menu/ScheduleEditor.tsx` | Schedule configuration UI |
| `src/lib/schedule-utils.ts` | Schedule checking logic |
| `src/app/api/menu/available/route.ts` | Available items API |
