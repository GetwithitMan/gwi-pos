# Worker 44: FloorPlanHome Theme Support

You are a DEVELOPER adding theme support to the FloorPlanHome component for FOH view.

## Context

The `FloorPlanHome` component in `src/components/floor-plan/FloorPlanHome.tsx` currently uses a light theme with hardcoded colors. It needs to accept a `theme` prop and apply colors dynamically.

## Files to Modify

```
═══════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THESE FILES
═══════════════════════════════════════════════════════════════════
```

1. `src/components/floor-plan/FloorPlanHome.tsx`
2. `src/app/test-floorplan/page.tsx` (update to use theme)

## Changes Required

### 1. FloorPlanHome.tsx

#### Add theme prop to interface

```typescript
import type { FloorPlanTheme } from '@/lib/theme';
import { darkTheme } from '@/lib/theme';

interface FloorPlanHomeProps {
  locationId: string;
  employeeId: string;
  // ... existing props
  theme?: FloorPlanTheme;
}
```

#### Apply theme to container

```typescript
export default function FloorPlanHome({
  locationId,
  employeeId,
  theme = darkTheme,
  // ... other props
}: FloorPlanHomeProps) {
  // Container style
  const containerStyle = {
    background: theme.canvasBg,
    border: `1px solid ${theme.canvasBorder}`,
    borderRadius: '12px',
  };
```

#### Apply theme to table rendering

Find where tables are rendered and update colors:

```typescript
// Table container style
const getTableStyle = (table: DbTable, isSelected: boolean) => ({
  fill: table.shape === 'circle' ? theme.tableCircleFill : theme.tableRectFill,
  stroke: table.shape === 'circle' ? theme.tableCircleStroke : theme.tableRectStroke,
  strokeWidth: isSelected ? 3 : 2,
  filter: isSelected ? `drop-shadow(${theme.tableSelectedGlow})` : 'none',
});
```

#### Apply theme to seats

```typescript
// Seat style
const getSeatStyle = (isSelected: boolean) => ({
  fill: isSelected ? theme.seatSelectedFill : theme.seatFill,
  stroke: theme.seatStroke,
  color: theme.seatText,
});
```

#### Apply theme to virtual group outlines

```typescript
// Virtual group border
const virtualGroupStyle = {
  stroke: theme.virtualGroupBorder,
  fill: theme.virtualGroupBg,
  strokeDasharray: '6 4',
};
```

#### Apply theme to UI buttons

```typescript
// Room tabs
const roomTabStyle = (isActive: boolean) => ({
  background: isActive ? theme.buttonPrimary : theme.buttonSecondary,
  color: isActive ? '#fff' : theme.textMuted,
  border: `1px solid ${theme.panelBorder}`,
});

// Action buttons (Hide Seats, Reset Groups)
const actionButtonStyle = {
  background: theme.buttonSecondary,
  color: theme.textMuted,
  border: `1px solid ${theme.panelBorder}`,
};
```

#### Apply theme to text

```typescript
// Table labels
const tableLabelStyle = {
  color: theme.textPrimary,
  textShadow: theme.name === 'dark' ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
};

// Seat numbers
const seatNumberStyle = {
  color: theme.seatText,
  fontSize: '10px',
  fontWeight: 600,
};
```

### 2. test-floorplan/page.tsx

Update to use ThemeProvider:

```typescript
import { ThemeProvider, useFloorPlanTheme } from '@/contexts/ThemeContext';

function FloorPlanTestContent() {
  const { theme, themeName, toggleTheme } = useFloorPlanTheme();

  return (
    <div data-theme={themeName}>
      {/* Theme toggle */}
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold" style={{ color: theme.textPrimary }}>
          Floor Plan Test Page (FOH View)
        </h1>
        <button
          onClick={toggleTheme}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            background: theme.buttonSecondary,
            color: theme.textMuted,
            border: `1px solid ${theme.panelBorder}`,
          }}
        >
          {themeName === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>

      {/* FloorPlanHome with theme */}
      <FloorPlanHome
        locationId={locationId}
        employeeId={employeeId}
        theme={theme}
        // ... other props
      />
    </div>
  );
}

export default function TestFloorPlanPage() {
  return (
    <ThemeProvider defaultTheme="light">
      <FloorPlanTestContent />
    </ThemeProvider>
  );
}
```

## Color Mapping Reference

| Element | Dark Theme | Light Theme |
|---------|------------|-------------|
| Canvas BG | `#0f172a` → `#1e293b` gradient | `#ffffff` |
| Canvas Border | `rgba(255,255,255,0.1)` | `#e2e8f0` |
| Grid Dots | `rgba(99,102,241,0.15)` | `#e2e8f0` |
| Table Rect Fill | `#1e293b` | `#d1fae5` |
| Table Rect Stroke | `rgba(255,255,255,0.2)` | `#10b981` |
| Table Circle Fill | `#22c55e` | `#86efac` |
| Seat Fill | `#1e293b` | `#fff` |
| Seat Stroke | `rgba(255,255,255,0.3)` | `#10b981` |
| Text Primary | `#fff` | `#1e293b` |
| Text Muted | `#94a3b8` | `#64748b` |

## Elements to Theme (Checklist)

- [ ] Main container background
- [ ] Room/section tabs
- [ ] Table shapes (rect, circle, diamond, oval)
- [ ] Table labels (T1, T2, etc.)
- [ ] Seat capacity badges
- [ ] Seat circles
- [ ] Seat numbers
- [ ] Virtual group outlines
- [ ] Virtual group labels ("Party of 16")
- [ ] Action buttons (Hide Seats, Reset Groups)
- [ ] Status indicators (available, occupied, dirty)
- [ ] Combined table indicators

## Acceptance Criteria

- [ ] FloorPlanHome accepts `theme` prop
- [ ] Defaults to `darkTheme` when no theme provided
- [ ] All tables use theme colors
- [ ] All seats use theme colors
- [ ] Virtual groups use theme colors
- [ ] Buttons use theme styles
- [ ] Text uses theme colors
- [ ] Test page has theme toggle
- [ ] Both themes look professional
- [ ] No visual glitches during theme switch

## Limitations

- Do NOT change component logic
- Do NOT change virtual combining logic
- Do NOT change order integration
- ONLY add theme prop and apply colors
- Default to dark theme for production compatibility
