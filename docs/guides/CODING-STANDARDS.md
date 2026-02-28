# Coding Standards — GWI POS

Reference for AI agents working on this codebase. Follow these rules exactly.

---

## Socket-First Performance

Cross-terminal updates **MUST** use Socket.io. Never use polling for data that can arrive via socket.

| Rule | Detail |
|------|--------|
| Emit from API routes | `emitToLocation(locationId, event, payload)` or `emitToTags(tags, event, payload)` |
| Client socket | Always `getSharedSocket()` from `src/lib/shared-socket.ts` |
| Release on unmount | Call `releaseSharedSocket()` in cleanup / `useEffect` return |
| Direct `io()` | **NEVER** — always use `getSharedSocket()` |
| `setInterval` polling | **NEVER** for data that can come via socket |
| Fallback polling | 30s interval, only when `isConnected === false` |

---

## Delta Updates for Lists

| Event type | Action |
|------------|--------|
| Removal (paid, voided, deleted, bumped) | Remove from local state — zero network requests |
| Addition / change | Debounced full refresh — minimum 150ms debounce |

**NEVER** refetch an entire list on every socket event.

---

## Caches — Use Existing

| Data | Cache |
|------|-------|
| Menu data (60s TTL) | `src/lib/menu-cache.ts` |
| Location settings | `src/lib/location-cache.ts` |
| Floor plan snapshot | `GET /api/floorplan/snapshot` |
| Open orders summary | `GET /api/orders/open?summary=true` |
| Bulk menu items | `GET /api/menu/items/bulk` |

**NEVER** write fresh DB queries for data that is already cached.

---

## Zustand Patterns

```typescript
// CORRECT — atomic selector
const field = useStore(s => s.field)

// WRONG — never destructure
const { field, other } = useStore()
```

- Single `set()` per interaction — compute totals in JS first, then call `set()` once
- **NEVER** call `set()` then a separate `calculateTotals()` — do it all in one `set()`

---

## API Route Conventions

### Wrapper & Auth
```typescript
export const GET = withVenue(async (req, { venue }) => {
  // venue.locationId is guaranteed
})
```
Every route **must** be wrapped with `withVenue()` from `src/lib/with-venue.ts`.

### Response Format
```typescript
return NextResponse.json({ data: result })      // success
return NextResponse.json({ error: 'Not found' }, { status: 404 }) // error
```

### Fire-and-Forget Side Effects
Non-critical work (inventory update, print job, socket dispatch) **must** be fire-and-forget:
```typescript
void updateInventory(itemId).catch(console.error)
void emitToLocation(locationId, 'order:updated', payload).catch(console.error)
return NextResponse.json({ data: order })  // return immediately
```
**NEVER** `await` background work before returning the response.

### Indexes — Required for New Query Patterns
```prisma
@@index([locationId, status])   // add compound index for multi-column filters
@@index([locationId])           // minimum for every new model
```

### N+1 Prevention
```typescript
// WRONG — N+1 loop
for (const item of items) {
  const modifier = await db.modifier.findUnique({ where: { id: item.modifierId } })
}

// CORRECT — batch + Map lookup
const modifiers = await db.modifier.findMany({
  where: { id: { in: items.map(i => i.modifierId) } }
})
const modifierMap = new Map(modifiers.map(m => [m.id, m]))
const enriched = items.map(i => ({ ...i, modifier: modifierMap.get(i.modifierId) }))
```

---

## Multi-Tenancy Query Rules

Every query **must** include `locationId`. No exceptions (except `Organization` and `Location` tables).

```typescript
// CORRECT
await db.order.findMany({
  where: { locationId, deletedAt: null }
})

// WRONG — missing locationId and deletedAt filter
await db.order.findMany({ where: { status: 'open' } })
```

| Rule | Detail |
|------|--------|
| Filter by locationId | Every query on every table |
| Exclude deleted | Always `deletedAt: null` |
| Include on create | Always pass `locationId` when creating records |
| Soft delete only | `deletedAt: new Date()` — **never** hard delete |

### Schema Convention for New Models
```prisma
model NewModel {
  id         String    @id @default(cuid())
  locationId String
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?
  syncedAt   DateTime?

  @@index([locationId])
}
```

---

## Toast Notifications

```typescript
import { toast } from '@/stores/toast-store'

toast.success('Order saved')
toast.error('Connection lost', 8000)  // optional duration (ms)
toast.info('Printer connected')
toast.warning('Low paper')
```

| Level | Auto-dismiss |
|-------|-------------|
| success / info | 5 seconds |
| error / warning | 7 seconds |

Toasts stack vertically, bottom-right. Do not use `alert()` or `console.log` as user feedback.

---

## Instant UI Feedback

- Modals and panels **must** open instantly — run background work after opening
- Cash payment: close modal immediately, process payment in background
- **NEVER** block the UI on network requests the user doesn't need to wait for

```typescript
// CORRECT
openModal()
void processPayment(order).catch(handleError)

// WRONG
await processPayment(order)
openModal()
```

---

## Common API Patterns

| Pattern | Rule |
|---------|------|
| Decimal fields | Convert with `Number()` when returning from API |
| JSON fields | Use for structured data (`modifierTypes`, `pourSizes`) |
| Soft deletes | `deletedAt: new Date()` — required for Android sync |
| Sort order | Include `sortOrder` field on lists that users can reorder |

---

## Project Structure

```
gwi-pos/
├── server.ts            # Custom server (Socket.io + multi-tenant routing)
├── preload.js           # AsyncLocalStorage polyfill (loaded via -r flag)
├── prisma/              # Schema, seed, migrations
├── public/
│   └── installer.run    # NUC provisioning script (~1,454 lines)
├── src/
│   ├── app/
│   │   ├── (auth)/      # Login pages
│   │   ├── (pos)/       # POS interface
│   │   ├── (admin)/     # Admin pages
│   │   ├── (kds)/       # Kitchen Display System
│   │   └── api/         # API routes (all wrapped with withVenue)
│   ├── components/      # React components
│   ├── hooks/           # Custom hooks
│   ├── stores/          # Zustand stores
│   ├── lib/
│   │   ├── db.ts              # Prisma client (3-tier Proxy: ALS → headers → master)
│   │   ├── with-venue.ts      # Route handler wrapper for multi-tenant isolation
│   │   ├── request-context.ts # AsyncLocalStorage for per-request tenant context
│   │   ├── socket-server.ts   # Socket.io server init + emitToLocation/emitToTags
│   │   ├── shared-socket.ts   # Client-side singleton socket connection
│   │   ├── menu-cache.ts      # In-memory menu cache (60s TTL)
│   │   ├── location-cache.ts  # Location settings cache
│   │   ├── datacap/           # All payment processing code
│   │   ├── escpos/            # ESC/POS printing protocol
│   │   ├── order-events/      # Event-sourced order pipeline
│   │   └── inventory-calculations.ts  # Deduction engine
│   └── types/           # TypeScript types
├── docs/
│   ├── skills/          # Skill docs (347+ skills)
│   ├── changelogs/      # Domain changelogs
│   ├── domains/         # Domain reference docs
│   └── guides/          # Guide docs (you are here)
└── CLAUDE.md            # Routing file
```

---

## Application Routes

### POS Routes
| Route | Description |
|-------|-------------|
| `/login` | PIN-based login |
| `/orders` | Main POS order screen |
| `/kds` | Kitchen Display System |
| `/kds/entertainment` | Entertainment KDS |

### Admin Routes (via hamburger menu)
| Route | Description |
|-------|-------------|
| `/menu` | Menu management |
| `/modifiers` | Modifier group management |
| `/employees` | Employee management |
| `/tables` | Floor plan / table layout |
| `/settings` | System settings |
| `/settings/order-types` | Order types config |
| `/settings/tip-outs` | Tip-out rules |
| `/reports` | Sales and labor reports |
| `/reports/daily` | Daily store report (EOD) |
| `/customers` | Customer management |
| `/reservations` | Reservation system |
| `/ingredients` | Food inventory |
| `/inventory` | Inventory tracking |
| `/liquor-builder` | Liquor/spirit recipe builder |

---

## Inventory & Recipe Costing

### Modifier Instruction Multipliers
| Instruction | Multiplier |
|-------------|------------|
| NO, HOLD, REMOVE | 0.0 |
| LITE, LIGHT, EASY | 0.5 |
| NORMAL, REGULAR | 1.0 |
| EXTRA, DOUBLE | 2.0 |
| TRIPLE, 3X | 3.0 |

Configurable per-location in InventorySettings. "No" logic: skips base recipe deduction entirely.

### Auto-Deduction (fire-and-forget)
- **Order Paid** → `deductInventoryForOrder()` (transaction type: `sale`)
- **Item Voided** → `deductInventoryForVoidedItem()` (transaction type: `waste`)
- Two-path modifier deduction: Path A (`ModifierInventoryLink`) takes precedence over Path B (`Modifier.ingredientId` fallback)

**Key files:** `src/lib/inventory-calculations.ts`, `/api/orders/[id]/pay/route.ts`, `/api/orders/[id]/comp-void/route.ts`

---

## Hardware & Printing

### Printer Types & Roles
- Types: `thermal` (receipts), `impact` (kitchen)
- Roles: `receipt`, `kitchen`, `bar`

### Print Route Priority
`PrintRoute > Item printer > Category printer > Default`
- Backup printer failover with configurable timeout
- Per-modifier print routing: `follow` (default), `also`, `only`

### ESC/POS Protocol
| Printer | Double size | Normal |
|---------|------------|--------|
| Thermal | `GS ! 0x11` | `GS ! 0x00` |
| Impact | `ESC ! 0x30` | `ESC ! 0x00` |
| Two-color | `ESC r 0x01` (red) | `ESC r 0x00` (black) |

### KDS Device Security
256-bit token + httpOnly cookie + 5-min pairing code. Optional static IP binding. See `docs/skills/102-KDS-DEVICE-SECURITY.md`.

**Key files:** `src/lib/escpos/`, `src/lib/printer-connection.ts`, `/api/print/kitchen/route.ts`
