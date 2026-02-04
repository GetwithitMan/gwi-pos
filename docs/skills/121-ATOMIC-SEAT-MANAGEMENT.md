# Skill 121: Atomic Seat Management & Positional Indexing

## Overview

Allows servers to dynamically add or remove seats mid-meal with automatic positional shifting of existing seats and their items. Uses optimistic concurrency control for safe multi-terminal operations.

## The Problem

In full-service restaurants, guest count often changes after the initial seating:
- Extra guest joins late → Need to add a seat
- Guest leaves early → Need to remove a seat
- Table combines happen → Seats need to be renumbered

Without proper seat management:
- Items get assigned to non-existent seats
- Split checks become inaccurate
- Kitchen tickets show wrong seat numbers

## Solution: Positional Indexing

Seats are treated as **positional indexes**, not static IDs. When a seat is inserted or removed, all higher seats shift to maintain contiguous numbering.

### INSERT at Position 3 (4 seats → 5 seats)
```
Before: [S1, S2, S3, S4]
After:  [S1, S2, NEW, S3→S4, S4→S5]

Items on S3 become S4, items on S4 become S5
```

### REMOVE at Position 2 (4 seats → 3 seats)
```
Before: [S1, S2, S3, S4]
After:  [S1, S3→S2, S4→S3]

Items on S2 go to "Shared", items on S3 become S2, etc.
```

## Database Schema

### Order Model Additions

```prisma
model Order {
  // ... existing fields ...

  // Atomic Seat Management (Skill 121)
  baseSeatCount   Int      @default(1)  // Original seat count when order opened
  extraSeatCount  Int      @default(0)  // Additional seats added (can be negative)
  seatVersion     Int      @default(0)  // Monotonic counter for concurrency
  seatTimestamps  Json?                 // When each seat was added
}
```

### Field Explanations

| Field | Purpose |
|-------|---------|
| `baseSeatCount` | Original guest count at order creation |
| `extraSeatCount` | Delta from base (positive = added, negative = removed) |
| `seatVersion` | Increments on every seat change for optimistic locking |
| `seatTimestamps` | JSON: `{ "1": "2026-02-01T10:00:00Z", "2": "...", ... }` |

### Total Seat Calculation

```typescript
totalSeats = baseSeatCount + extraSeatCount
```

## API Endpoint

### GET /api/orders/[id]/seating

Returns current seating information with per-seat balances.

**Response:**
```json
{
  "orderId": "clx...",
  "baseSeatCount": 4,
  "extraSeatCount": 1,
  "totalSeats": 5,
  "seatVersion": 3,
  "seatBalances": [
    {
      "seatNumber": 1,
      "subtotal": 24.50,
      "taxAmount": 1.96,
      "total": 26.46,
      "itemCount": 2,
      "status": "active",
      "addedAt": "2026-02-01T10:00:00Z"
    },
    // ... more seats
  ],
  "sharedItems": {
    "itemCount": 1,
    "subtotal": 8.00
  }
}
```

### POST /api/orders/[id]/seating

Performs atomic INSERT or REMOVE operation.

**Request Body:**
```json
{
  "action": "INSERT" | "REMOVE",
  "position": 3,
  "seatVersion": 2  // Optional: for optimistic locking
}
```

**INSERT Response:**
```json
{
  "action": "INSERT",
  "position": 3,
  "newTotalSeats": 5,
  "seatVersion": 3,
  "itemsShifted": 4
}
```

**REMOVE Response:**
```json
{
  "action": "REMOVE",
  "position": 2,
  "newTotalSeats": 4,
  "seatVersion": 3,
  "itemsMovedToShared": 2,
  "itemsShifted": 3
}
```

## Seat Status System

Each seat has a status based on its items:

| Status | Color | Description |
|--------|-------|-------------|
| `empty` | Gray (#6b7280) | No items assigned |
| `active` | Green (#22c55e) | Items added/modified within 5 minutes |
| `stale` | Amber (#f59e0b) | Has items but no recent activity |
| `printed` | Blue (#3b82f6) | Items sent to kitchen |
| `paid` | Purple (#a855f7) | Seat fully paid |

## Components

### SeatOrbiter

Visual ring of seats around a table shape with Framer Motion animations.

```tsx
import { SeatOrbiter } from '@/components/floor-plan/SeatOrbiter'

<SeatOrbiter
  seats={seats}
  selectedSeatNumber={activeSeatNumber}
  onSeatSelect={handleSeatSelect}
  onAddSeat={handleAddSeat}
  showAddButton={true}
  showBalances={true}
  size="md"
  orbitRadius={60}
/>
```

### SeatBar

Compact horizontal bar for order panels.

```tsx
import { SeatBar } from '@/components/floor-plan/SeatOrbiter'

<SeatBar
  seats={seats}
  selectedSeatNumber={activeSeatNumber}
  onSeatSelect={handleSeatSelect}
  onAddSeat={handleAddSeat}
/>
```

### SeatStatusLegend

Displays color legend for seat statuses.

```tsx
import { SeatStatusLegend } from '@/components/floor-plan/SeatOrbiter'

<SeatStatusLegend />
```

## Hook: useSeating

```typescript
import { useSeating } from '@/hooks/useSeating'

const {
  seats,
  totalSeats,
  seatVersion,
  isLoading,
  error,
  addSeat,
  removeSeat,
  refreshSeating,
  sharedItemsCount,
  sharedItemsTotal,
} = useSeating({
  orderId: currentOrderId,
  // OR provide items for local calculation:
  items: inlineOrderItems,
  payments: [],
  taxRate: 0.08,
})

// Add a seat at the end
await addSeat()

// Add a seat at position 3
await addSeat(3)

// Remove seat 2
await removeSeat(2)
```

## Utility Functions

```typescript
import {
  calculateSeatBalance,
  determineSeatStatus,
  calculateAllSeatBalances,
  calculateSeatPositions,
  SEAT_STATUS_COLORS,
  SEAT_STATUS_BG_COLORS,
} from '@/lib/seat-utils'

// Calculate balance for a single seat
const balance = calculateSeatBalance(items, seatNumber, taxRate)

// Get status based on items and payments
const status = determineSeatStatus(items, seatNumber, payments)

// Calculate all seats at once
const allSeats = calculateAllSeatBalances(items, totalSeats, payments, taxRate)

// Position seats around a circle
const positions = calculateSeatPositions(seatCount, orbitRadius, startAngle)
```

## Concurrency Control

The `seatVersion` field prevents race conditions when multiple terminals modify seats simultaneously.

**Flow:**
1. Client fetches current `seatVersion`
2. Client sends INSERT/REMOVE with `seatVersion`
3. Server checks if version matches
4. If mismatch: Returns 409 Conflict
5. If match: Performs operation, increments version

**Error Response (409):**
```json
{
  "error": "Seat configuration has changed. Please refresh and try again."
}
```

## Integration in FloorPlanHome

The "Add Seat" button (+) appears next to seat selection buttons when an active order exists.

```
[Shared] [1] [2] [3] [4] [+]
```

Clicking [+] calls the seating API to add a new seat at the end.

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Order model with seat fields |
| `src/app/api/orders/[id]/seating/route.ts` | GET/POST seating API |
| `src/lib/seat-utils.ts` | Balance calculations, status colors |
| `src/components/floor-plan/SeatOrbiter.tsx` | Visual seat components |
| `src/hooks/useSeating.ts` | Seating state management hook |
| `src/components/floor-plan/FloorPlanHome.tsx` | Add seat UI integration |

## Status: Complete

- Schema fields added to Order model
- Seating API with INSERT/REMOVE operations
- Per-seat balance calculations
- Seat status color system
- SeatOrbiter and SeatBar components
- useSeating hook for state management
- FloorPlanHome integration with Add Seat button
