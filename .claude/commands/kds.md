# Kitchen Display System (KDS)

Display incoming orders for kitchen staff to prepare.

## Overview

The KDS shows orders requiring kitchen preparation:
- New orders appear automatically
- Color-coded by age/priority
- Bump orders when complete
- Filter by prep station

## Access

Navigate to `/kds` for the kitchen display.

## Display Features

### Order Cards
Each order shows:
- Order number (bold)
- Table/tab name
- Server name
- Time since ordered
- Items with modifiers

### Color Coding
- **Green**: Fresh order (< 5 min)
- **Yellow**: Aging (5-10 min)
- **Red**: Overdue (> 10 min)

### Item Status
- Pending: Not started
- In Progress: Being made
- Ready: Complete, waiting for expo

## Actions

### Bump Order
Mark order complete and remove from display:
1. Tap order card
2. Click "Bump" or press bump bar
3. Order moves to completed

### Recall
Bring back a bumped order:
1. Click "Recall" button
2. Select order to restore
3. Order returns to queue

## Prep Stations

Filter orders by station:
- Grill
- Fry
- Salad
- Dessert
- Expo

Each station sees only relevant items.

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/kds` | Get active orders |
| `POST /api/kds/bump` | Bump order |
| `POST /api/kds/recall` | Recall order |
| `GET /api/kds/history` | Recently completed |

## Course Firing

Orders can be sent by course:
1. Server marks items by course (1, 2, 3)
2. Course 1 fires immediately
3. Server fires next course when ready
4. KDS shows only fired items

## Hold & Fire

Items can be held:
1. Server holds item in POS
2. Item shows "HOLD" on KDS
3. Server fires when ready
4. Item appears for preparation

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/kds/page.tsx` | KDS display |
| `src/app/api/kds/route.ts` | KDS API |
| `src/components/kds/OrderCard.tsx` | Order display |

## Settings

Configure in `/settings`:
- Alert times (yellow/red thresholds)
- Sound notifications
- Auto-bump after time
- Prep station assignments
