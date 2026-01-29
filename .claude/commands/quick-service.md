# Quick Service Mode

Counter service without table assignment for fast-casual operations.

## Overview

Quick service mode streamlines ordering for counter service, food trucks, and fast-casual restaurants where table assignment isn't needed.

## When to Use

| Scenario | Mode |
|----------|------|
| Fast food counter | Quick Service |
| Food truck | Quick Service |
| Coffee shop | Quick Service |
| Bar tab | Quick Service (Bar Tab type) |
| Full service dining | Table Service |

## Quick Service Flow

### Order Flow
1. Customer approaches counter
2. Server starts order (no table needed)
3. Add items quickly
4. Payment immediately or ticket number
5. Order sent to kitchen
6. Customer picks up when ready

### No Table Required
- Skip table selection
- Order type: "Counter" or "Quick Sale"
- Customer name optional
- Ticket number assigned

## Order Types for Quick Service

### Counter Order
- No table, no tab name
- Immediate payment
- Ticket number for pickup
- Kitchen display shows number

### To-Go Order
- Takeout packaging
- Name for pickup
- Phone optional
- Kitchen marks as To-Go

### Bar Tab (Quick)
- Name or card on file
- Running tab
- Pay at end

## Configuration

### Enable Quick Service
1. Go to Settings
2. Order Settings
3. Enable "Quick Service Mode"
4. Configure default order type

### Quick Service Settings

| Setting | Description |
|---------|-------------|
| Default Order Type | Counter, To-Go, etc. |
| Require Customer Name | Yes/No |
| Auto-Number Orders | Ticket numbering |
| Payment Timing | Before send, After send |

## POS Interface

### Simplified View
- No table picker by default
- Large item buttons
- Quick payment buttons
- Order queue display

### Order Panel
```
Order #47
━━━━━━━━━━━━━━━━━
2x Burger         $17.98
1x Fries           $4.99
1x Coke            $2.99
━━━━━━━━━━━━━━━━━
Total:            $25.96

[Cash] [Card] [Send]
```

## Ticket Numbers

### Auto-Numbering
- Sequential per day
- Resets at midnight or shift
- Displayed prominently

### Display Options
- Order monitor shows numbers
- Receipt shows ticket #
- KDS shows ticket #

## Kitchen Integration

### KDS Display
```
┌────────────────────┐
│ #47 - COUNTER      │
│ 2x Burger          │
│ 1x Fries           │
│ 1x Coke            │
│                    │
│ [READY]            │
└────────────────────┘
```

### Ready Notification
- Mark ready on KDS
- Display updates
- Optional audio alert
- Customer called

## Order Monitor

### Customer-Facing Display
Shows:
- Orders being prepared
- Orders ready for pickup
- Ticket numbers prominently

### Layout
```
PREPARING          READY
━━━━━━━━━━         ━━━━━━━━━━
#45                #42
#46                #43
#47                #44
```

## Payment Options

### Pay First
- Payment before kitchen send
- Common for fast food
- No walkout risk

### Pay After
- Send to kitchen first
- Customer pays when ready
- Requires ticket tracking

### Split Quick Payment
- Cash amount
- Remainder on card
- Fast checkout

## Modifiers

### Quick Modifiers
- One-tap common options
- "No onion", "Extra cheese"
- Speed up ordering

### Modifier Shortcuts
- Pre-configured combos
- "Make it a meal"
- One-click additions

## API Endpoints

### Create Quick Order
```
POST /api/orders
{
  "locationId": "xxx",
  "employeeId": "yyy",
  "orderType": "counter",
  "items": [...]
}
```

### Mark Ready
```
PATCH /api/orders/[id]
{
  "status": "ready"
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Supports quick service |
| `src/components/orders/QuickPayment.tsx` | Fast payment UI |
| `src/app/(kds)/order-monitor/page.tsx` | Customer display |
| `src/types/order-types.ts` | Counter order type |
