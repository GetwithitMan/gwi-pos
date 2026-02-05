# Worker 43: FOH View Migration (Orders Page)

You are a DEVELOPER replacing the floor plan section in the Orders page with the new FloorPlanHome component.

## Context

The `/orders` page displays a floor plan for table selection. The current implementation needs to be replaced with `FloorPlanHome` from `src/components/floor-plan/FloorPlanHome.tsx`, which supports virtual table combining and inline ordering.

## Files to Analyze First

Before modifying, READ these files to understand the current implementation:
- `src/app/(pos)/orders/page.tsx` - Find the floor plan section
- `src/components/floor-plan/FloorPlanHome.tsx` - The replacement component

## Files to Modify

```
═══════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THIS FILE
═══════════════════════════════════════════════════════════════════
```

1. `src/app/(pos)/orders/page.tsx` - Replace floor plan section

## Current Orders Page Structure

The orders page likely has:
1. Header with order type tabs (Tables, Takeout, Delivery, etc.)
2. Category bar for menu items
3. **Floor plan area** (this is what we're replacing)
4. Order panel on the right
5. Payment/action buttons

## Integration Requirements

The `FloorPlanHome` component expects these props:

```typescript
interface FloorPlanHomeProps {
  locationId: string;
  employeeId: string;
  onTableSelect?: (tableId: string, tableName: string) => void;
  onOpenPayment?: (orderId: string) => void;
  onOpenModifiers?: (item: MenuItem, quantity: number) => void;
  onOpenTimedRental?: (item: MenuItem) => void;
  onOpenPizzaBuilder?: (item: MenuItem) => void;
  orderToLoad?: string | null;
  onOrderLoaded?: () => void;
  paidOrderId?: string | null;
  onPaidOrderCleared?: () => void;
  theme?: FloorPlanTheme;
}
```

## Implementation Steps

### Step 1: Identify the floor plan section

Look for elements like:
- `InteractiveFloorPlan`
- Table grid/canvas
- Section tabs (Back Room, Front Room, etc.)

### Step 2: Import FloorPlanHome

```typescript
import { FloorPlanHome } from '@/components/floor-plan/FloorPlanHome';
import { ThemeProvider, useFloorPlanTheme } from '@/contexts/ThemeContext';
```

### Step 3: Wire up callbacks

The Orders page likely has handlers for:
- `handleTableClick(tableId)` → Connect to `onTableSelect`
- `openPaymentModal(orderId)` → Connect to `onOpenPayment`
- `openModifierModal(item)` → Connect to `onOpenModifiers`

### Step 4: Replace the floor plan JSX

Find the section rendering the floor plan (likely in the left/center area) and replace with:

```tsx
{/* Floor Plan Section */}
<div className="flex-1 relative">
  <ThemeProvider defaultTheme="dark">
    <FloorPlanHomeWithTheme
      locationId={employee.location.id}
      employeeId={employee.id}
      onTableSelect={handleTableSelect}
      onOpenPayment={handleOpenPayment}
      onOpenModifiers={handleOpenModifiers}
      onOpenTimedRental={handleOpenTimedRental}
      onOpenPizzaBuilder={handleOpenPizzaBuilder}
      orderToLoad={selectedOrderId}
      onOrderLoaded={() => setSelectedOrderId(null)}
      paidOrderId={paidOrderId}
      onPaidOrderCleared={() => setPaidOrderId(null)}
    />
  </ThemeProvider>
</div>
```

### Step 5: Create theme wrapper component

```tsx
function FloorPlanHomeWithTheme(props: Omit<FloorPlanHomeProps, 'theme'>) {
  const { theme } = useFloorPlanTheme();
  return <FloorPlanHome {...props} theme={theme} />;
}
```

## Key Callbacks to Wire

### onTableSelect
Called when user taps a table. Should:
1. Check if table has existing order
2. Either load existing order or create new one
3. Update selected order state

### onOpenPayment
Called when "Pay" button is clicked. Should:
1. Open payment modal
2. Pass orderId to modal

### onOpenModifiers
Called when menu item needs modifier selection. Should:
1. Open modifier modal
2. Pass item and quantity

### onOrderLoaded
Called after order is loaded from `orderToLoad`. Should:
1. Clear `orderToLoad` state
2. Prevent re-loading loops

### onPaidOrderCleared
Called after receipt is closed. Should:
1. Clear `paidOrderId` state
2. Return to floor plan view

## State to Add (if not existing)

```typescript
const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
const [paidOrderId, setPaidOrderId] = useState<string | null>(null);
```

## Acceptance Criteria

- [ ] Floor plan renders in Orders page
- [ ] Tables display with correct status (available, occupied, dirty)
- [ ] Table tap starts/loads order
- [ ] Section tabs work (Back Room, Front Room, etc.)
- [ ] Virtual table combining works (drag to combine)
- [ ] Combined tables show perimeter seats
- [ ] Reset Groups button works
- [ ] Hide Seats toggle works
- [ ] Order panel updates when table selected
- [ ] Payment flow works
- [ ] Theme applies correctly (dark by default)

## Limitations

- Do NOT modify FloorPlanHome.tsx
- Do NOT modify API endpoints
- Do NOT change the overall Orders page layout
- ONLY replace the floor plan section
- Keep all existing order handling logic
