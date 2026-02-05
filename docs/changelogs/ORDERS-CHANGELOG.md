# Orders Domain - Change Log

## Session: February 5, 2026 (Domain Initialization)

### Domain Overview

The Orders domain handles the core POS workflow: creating orders, adding items, sending to kitchen, payments, and order management.

### Current State

**Main File:** `src/app/(pos)/orders/page.tsx` - **5,031 lines** (needs refactoring)

**Key Components:**
| Component | Purpose | Lines |
|-----------|---------|-------|
| `OpenOrdersPanel.tsx` | Bar tabs list, open orders | ~500 |
| `CompVoidModal.tsx` | Void/comp operations | ~400 |
| `PaymentModal.tsx` | Payment processing | ~800 |
| `SplitCheckModal.tsx` | Split bill functionality | ~300 |
| `EntertainmentSessionControls.tsx` | Timed rental controls | ~310 |
| `OrderTypeSelector.tsx` | Order type buttons | ~200 |

**API Routes:**
| Route | Purpose |
|-------|---------|
| `/api/orders` | Create/list orders |
| `/api/orders/[id]` | Get/update order |
| `/api/orders/[id]/items` | Add/remove items |
| `/api/orders/[id]/send` | Send to kitchen |
| `/api/orders/[id]/pay` | Process payment |
| `/api/orders/[id]/comp-void` | Void/comp items |
| `/api/orders/[id]/split` | Split order |
| `/api/orders/open` | Get open orders |

### Known Issues / Priorities (from CLAUDE.md)

**Priority 1: Bar Tabs Screen**
- [ ] Improve tab list UI in OpenOrdersPanel
- [ ] Quick tab creation from floor plan
- [ ] Pre-auth card capture for tabs
- [ ] Tab transfer between employees
- [ ] Tab merge functionality

**Priority 2: Closed Orders Management**
- [ ] Closed orders list view with search/filter
- [ ] View closed order details
- [ ] Void payments on closed orders (manager approval)
- [ ] Adjust tips after close
- [ ] Reprint receipts
- [ ] Reopen closed orders (with reason)

**Priority 3: File Size / Refactoring**
- [ ] Split 5,031-line page.tsx into smaller components
- [ ] Extract hooks for order operations
- [ ] Move modals to separate files

---

## Session: February 5, 2026 (Architecture Planning)

### Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Bar Mode** | Own route (`/bar`) | Can evolve independently, speed-optimized |
| **Top Bar** | Nav + Quick Actions | New Tab, Time Clock, Open Drawer always accessible |
| **Orders Panel** | Current order focus | Slower-paced, configurable default screen per employee/station |

### New Route Structure

```
/orders     → Floor Plan + Order Entry (slower-paced, table service)
/bar        → Speed Bar Mode (fast tab management, bartenders)
/tabs       → Tab Management (future - dedicated tab admin)
```

### Employee Default Screen

Each employee/station can have a default screen:
- Drive Thru → `/orders` with "Drive Thru" order type
- Dine In → `/orders` with floor plan
- Bar → `/bar`
- Phone Orders → `/orders` with "Phone Order" type

---

## Session: February 5, 2026 (Workers O1-O5 Completed)

### Completed Workers

| Worker | Task | Status | Files |
|--------|------|--------|-------|
| O4 | Employee Default Screen Setting | ✅ Complete | `schema.prisma`, `employees/[id]/route.ts`, `login/page.tsx` |
| O1 | Persistent TopBar Component | ✅ Complete | `src/components/pos/TopBar.tsx` (182 lines) |
| O3 | Shared OrderPanel Component | ✅ Complete | `OrderPanel.tsx`, `OrderPanelItem.tsx`, `OrderPanelActions.tsx` |
| O5 | Refactor orders/page.tsx | ✅ Complete | `orders/page.tsx` (5,078 → 4,463 lines, 12% smaller) |
| O2 | /bar Route with BarModePage | ✅ Complete | `src/app/(pos)/bar/page.tsx` |

### Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/components/pos/TopBar.tsx` | 182 | Persistent nav bar with quick actions |
| `src/components/orders/OrderPanel.tsx` | 171 | Main order container component |
| `src/components/orders/OrderPanelItem.tsx` | 182 | Individual item row with entertainment support |
| `src/components/orders/OrderPanelActions.tsx` | 72 | Send/Pay/Discount action buttons |
| `src/app/(pos)/bar/page.tsx` | ~400 | Dedicated bar mode route |

### Schema Changes

```prisma
model Employee {
  // ... existing fields
  defaultScreen     String?   @default("orders")  // 'orders' | 'bar' | 'kds'
  defaultOrderType  String?                       // Slug for pre-selected order type
}
```

### Architecture Implemented

```
/orders     → Floor Plan + Order Entry (servers, table service)
/bar        → Speed Bar Mode (bartenders, fast tab management)
```

**Login Redirect:** Employees now redirect to their `defaultScreen` after login.

---

## Session: February 5, 2026 (Workers O6-O13 Completed)

### Completed Workers (Bar Enhancements)

| Worker | Task | Status | File |
|--------|------|--------|------|
| O6 | Recent tabs sorting (updatedAt DESC) | ✅ Complete | `bar/page.tsx` |
| O7 | Employee ownership glow (emerald) | ✅ Complete | `bar/page.tsx` |
| O8 | Socket.io real-time updates | ✅ Complete | `bar/page.tsx` |

### Completed Workers (Menu Search Feature)

| Worker | Task | Status | File |
|--------|------|--------|------|
| O9 | Search API endpoint | ✅ Complete | `/api/menu/search/route.ts` |
| O10 | useMenuSearch hook | ✅ Complete | `/hooks/useMenuSearch.ts` |
| O11 | Search UI components | ✅ Complete | `/components/search/*` |
| O12 | Bar page integration + virtualization | ✅ Complete | `bar/page.tsx` |
| O13 | Orders page integration | ✅ Complete | `orders/page.tsx` |

### Files Created (Search Feature)

| File | Purpose |
|------|---------|
| `/src/app/api/menu/search/route.ts` | 2-layer search API (direct + ingredient) |
| `/src/hooks/useMenuSearch.ts` | Client-side + server-side search hook |
| `/src/components/search/MenuSearchInput.tsx` | Search input with icon/spinner |
| `/src/components/search/MenuSearchResults.tsx` | Overlay dropdown results |
| `/src/components/search/MenuSearchResultItem.tsx` | Individual result item |
| `/src/components/search/index.ts` | Barrel export |

### Search Feature Architecture

```
User types "Jack"
       ↓
  [300ms debounce]
       ↓
┌──────────────────────────────────┐
│  Layer 1: Client-Side (instant)  │
│  menuItems.filter(name match)    │
│  → "Jack's Famous Burger"        │
└──────────────────────────────────┘
       ↓ (parallel)
┌──────────────────────────────────┐
│  Layer 2: Server-Side (50-100ms) │
│  GET /api/menu/search?q=jack     │
│  → BottleProduct: "Jack Daniels" │
│    → MenuItem: "Jack & Coke"     │
│    → MenuItem: "Tennessee Mule"  │
└──────────────────────────────────┘
       ↓
┌──────────────────────────────────┐
│  Combined Results (deduplicated) │
│  MENU ITEMS (2)                  │
│  CONTAINS JACK DANIELS (4) 🥃    │
└──────────────────────────────────┘
```

### Key Features Implemented

- **Search Bar**: Below TopBar on both `/bar` and `/orders` screens
- **Keyboard Shortcuts**: ⌘K/Ctrl+K to focus, Escape to close
- **Overlay Dropdown**: Results overlay items grid (Google-style)
- **Ingredient Badges**: 🥃 spirit, 🍴 food
- **86'd Items**: Red styling with "86" badge, disabled
- **Tab Virtualization**: react-virtuoso for 500+ tabs performance
- **Employee Glow**: Emerald border/shadow on owned tabs

---

## Archived Worker Prompts

<details>
<summary>Click to expand original worker prompts</summary>

### Worker O1: Create Persistent TopBar Component

```
You are a DEVELOPER creating a persistent top navigation bar for GWI POS.

## Context
The top bar needs to be visible on both /orders and /bar screens, providing quick navigation and actions.

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - CREATE THESE FILES
═══════════════════════════════════════════════════════════════════════════════

**Files to Create:**
1. `src/components/pos/TopBar.tsx`

## Requirements

### Layout
```
┌─────────────────────────────────────────────────────────────────────┐
│ [☰] [🍽️ Orders] [🍺 Bar] │ [+ Tab] [⏱️ Clock] [💵 Drawer] │ 3:45 PM  John S. [▼] │
└─────────────────────────────────────────────────────────────────────┘
```

### Left Section (Navigation)
- Hamburger menu (☰) → Opens AdminNav sidebar
- Orders button → Link to /orders (highlight when active)
- Bar button → Link to /bar (highlight when active)

### Center Section (Quick Actions)
- [+ Tab] → Opens NewTabModal
- [⏱️ Clock] → Opens TimeClockModal
- [💵 Drawer] → Opens cash drawer (future: drawer management)

### Right Section (Status)
- Current time (updates every minute)
- Employee name
- Dropdown menu: Clock Out, Switch User, Settings

### Props Interface
```typescript
interface TopBarProps {
  employee: {
    id: string
    name: string
    role?: { name: string }
  }
  currentRoute: 'orders' | 'bar' | 'tabs'
  onOpenAdminNav: () => void
  onOpenNewTab: () => void
  onOpenTimeClock: () => void
  onOpenDrawer: () => void
  onLogout: () => void
}
```

### Styling
- Height: 56px (fixed)
- Background: Dark glass effect (bg-gray-900/95 backdrop-blur)
- Text: White/gray
- Buttons: Subtle hover states
- Active route: Blue highlight

## Acceptance Criteria
- [ ] Component renders with all sections
- [ ] Navigation links work (use Next.js Link)
- [ ] Active route is highlighted
- [ ] Clock updates every minute
- [ ] All callbacks fire correctly
- [ ] Responsive (collapses gracefully on small screens)
- [ ] No TypeScript errors
```

---

### Worker O2: Create /bar Route with BarModePage

```
You are a DEVELOPER creating a dedicated Bar Mode page for GWI POS.

## Context
Bar Mode needs its own route (/bar) optimized for speed - bartenders need to open tabs, add items, and close out quickly.

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - CREATE THESE FILES
═══════════════════════════════════════════════════════════════════════════════

**Files to Create:**
1. `src/app/(pos)/bar/page.tsx`
2. `src/app/(pos)/bar/layout.tsx` (optional, for shared layout)

## Requirements

### Page Structure
```
┌─────────────────────────────────────────────────────────────────────┐
│ TopBar (shared component)                                           │
├─────────────────────────────────────┬───────────────────────────────┤
│                                     │                               │
│  CATEGORIES (horizontal scroll)     │   TABS LIST                   │
│  [Cocktails] [Beer] [Wine] [Shots]  │   (always visible)            │
│                                     │                               │
│  ITEMS GRID                         │   ┌─────────────────────────┐ │
│  (large touch targets)              │   │ Tab: Mike's Party       │ │
│                                     │   │ $45.00 - 3 items        │ │
│  [Margarita]  [Old Fash]  [Mojito]  │   │ [View] [Pay] [Close]    │ │
│  [Corona]     [Modelo]    [Bud Lt]  │   ├─────────────────────────┤ │
│  [Cab Sauv]   [Pinot G]   [Rosé]    │   │ Tab: Table 5            │ │
│                                     │   │ $23.50 - 2 items        │ │
│                                     │   │ [View] [Pay] [Close]    │ │
│                                     │   └─────────────────────────┘ │
│                                     │                               │
│                                     │   [+ QUICK TAB]               │
│                                     │                               │
└─────────────────────────────────────┴───────────────────────────────┘
```

### Key Features
1. **Tabs List Always Visible** - Right side, scrollable
2. **Quick Tab Creation** - One tap to start new tab
3. **Large Touch Targets** - Minimum 64px height for items
4. **Horizontal Categories** - Quick category switching
5. **Item Grid** - 3-4 columns, easy scanning

### Tab Card Actions
- **View** → Expands to show items, allows adding more
- **Pay** → Opens PaymentModal
- **Close** → Quick close (requires payment first)

### State Management
- Use existing order store for orders
- Load open tabs on mount
- Real-time updates via socket (future)

### Initial Implementation
For now, import and use existing components:
- Use BartenderView logic as starting point
- Import PaymentModal, NewTabModal
- Import TopBar (from O1)

## Acceptance Criteria
- [ ] Route accessible at /bar
- [ ] Auth redirect if not logged in
- [ ] Categories load from API
- [ ] Items display in grid
- [ ] Tabs list shows open bar tabs
- [ ] Can create new tab
- [ ] Can add items to selected tab
- [ ] Can open payment modal
- [ ] TopBar visible and functional
- [ ] No TypeScript errors
```

---

### Worker O3: Create Shared OrderPanel Component

```
You are a DEVELOPER extracting the order panel into a shared component for GWI POS.

## Context
The order panel (right side showing current order, items, totals) needs to be a reusable component used by both /orders and /bar pages. This is the SOURCE OF TRUTH for all orders.

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - CREATE THESE FILES
═══════════════════════════════════════════════════════════════════════════════

**Files to Create:**
1. `src/components/orders/OrderPanel.tsx`
2. `src/components/orders/OrderPanelItem.tsx`
3. `src/components/orders/OrderPanelActions.tsx`

## Requirements

### OrderPanel.tsx - Main Container

```typescript
interface OrderPanelProps {
  // Order data
  orderId?: string | null
  orderNumber?: number
  orderType?: string
  tabName?: string
  tableId?: string

  // Items
  items: OrderPanelItem[]

  // Totals
  subtotal: number
  tax: number
  discounts: number
  total: number

  // Settings
  showItemControls?: boolean  // Edit/remove buttons
  showEntertainmentTimers?: boolean
  showCourseControls?: boolean

  // Callbacks
  onItemClick?: (item: OrderPanelItem) => void
  onItemRemove?: (itemId: string) => void
  onQuantityChange?: (itemId: string, delta: number) => void
  onSend?: () => void
  onPay?: () => void
  onHold?: () => void
  onDiscount?: () => void
  onSplit?: () => void
  onClear?: () => void

  // UI
  className?: string
  compact?: boolean  // For bar mode
}
```

### OrderPanelItem.tsx - Single Item Row

```typescript
interface OrderPanelItemProps {
  id: string
  name: string
  quantity: number
  price: number
  modifiers?: { name: string; price: number }[]
  specialNotes?: string

  // Status
  kitchenStatus?: 'pending' | 'sent' | 'cooking' | 'ready' | 'served'
  isHeld?: boolean

  // Entertainment
  isTimedRental?: boolean
  blockTimeMinutes?: number
  blockTimeStartedAt?: string
  blockTimeExpiresAt?: string

  // Controls
  showControls?: boolean
  onEdit?: () => void
  onRemove?: () => void
  onQuantityChange?: (delta: number) => void
}
```

### OrderPanelActions.tsx - Bottom Action Buttons

```typescript
interface OrderPanelActionsProps {
  hasItems: boolean
  hasSentItems: boolean
  canSend: boolean
  canPay: boolean

  onSend?: () => void
  onPay?: () => void
  onHold?: () => void
  onDiscount?: () => void
  onSplit?: () => void
  onClear?: () => void

  // Loading states
  isSending?: boolean
}
```

### Visual Design
- Clean, readable item list
- Clear price alignment (right)
- Modifier indentation
- Status badges (Sent, Cooking, Ready)
- Entertainment timer display
- Sticky action buttons at bottom

## Acceptance Criteria
- [ ] OrderPanel renders order data correctly
- [ ] Items display with modifiers and notes
- [ ] Entertainment timers show countdown
- [ ] Action buttons respect hasItems/canSend states
- [ ] Callbacks fire correctly
- [ ] Works in both full and compact modes
- [ ] No TypeScript errors
```

---

### Worker O4: Add Employee Default Screen Setting

```
You are a DEVELOPER adding default screen settings for employees in GWI POS.

## Context
Each employee or station needs a configurable default screen that loads after login.

═══════════════════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - MODIFY THESE FILES
═══════════════════════════════════════════════════════════════════════════════

**Files to Modify:**
1. `prisma/schema.prisma` - Add field to Employee model
2. `src/app/api/employees/[id]/route.ts` - Include in GET/PUT
3. `src/app/(auth)/login/page.tsx` - Redirect based on setting

## Schema Change

Add to Employee model:
```prisma
model Employee {
  // ... existing fields

  // Default screen after login
  // 'orders' | 'bar' | 'floor-plan' | 'kds'
  defaultScreen     String?   @default("orders")

  // Default order type to pre-select (slug)
  defaultOrderType  String?
}
```

## API Changes

### GET /api/employees/[id]
Include `defaultScreen` and `defaultOrderType` in response.

### PUT /api/employees/[id]
Allow updating `defaultScreen` and `defaultOrderType`.

## Login Redirect Logic

After successful login in `/login/page.tsx`:

```typescript
// Get default screen from employee data
const defaultScreen = employee.defaultScreen || 'orders'

// Redirect based on setting
switch (defaultScreen) {
  case 'bar':
    router.push('/bar')
    break
  case 'kds':
    router.push('/kds')
    break
  case 'floor-plan':
  case 'orders':
  default:
    router.push('/orders')
    break
}
```

## Acceptance Criteria
- [ ] Schema has new fields
- [ ] Migration runs cleanly
- [ ] API returns/updates new fields
- [ ] Login redirects based on defaultScreen
- [ ] Falls back to /orders if not set
- [ ] No TypeScript errors
```

---

## How to Resume

```
PM Mode: Orders
```

Then review this changelog and select tasks to work on.

</details>

---

## User Feedback (To Address)

From today's session:
1. ✅ Recent tabs sorted "most active first" → Worker O6
2. ✅ Color border/glow for employee's own tabs → Worker O7
3. ✅ Socket performance for 30-50 concurrent bartenders → Worker O8
4. ⚠️ Worker prompts should be ordered by deployment dependencies

---

## Next Steps (After O6-O8 Complete)

1. **Test bar mode end-to-end** - Create tab → Add items → Pay → Close
2. **Integrate TopBar into /orders** - Currently only in /bar
3. **Add socket dispatch to order APIs** - Emit events on order:created/updated/closed
4. **Tab merge functionality** - Combine multiple tabs
5. **Pre-auth card capture** - Hold card for bar tabs
