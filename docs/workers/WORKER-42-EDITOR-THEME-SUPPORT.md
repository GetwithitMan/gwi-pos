# Worker 42: EditorCanvas Theme Support

You are a DEVELOPER adding theme support to the Floor Plan Editor domain components.

## Context

The `FloorPlanEditor` and related components in `src/domains/floor-plan/admin/` need to accept a `theme` prop and apply colors from the theme object instead of hardcoded values.

## Files to Modify

```
═══════════════════════════════════════════════════════════════════
⚠️  STRICT BOUNDARY - ONLY MODIFY THESE FILES
═══════════════════════════════════════════════════════════════════
```

1. `src/domains/floor-plan/admin/FloorPlanEditor.tsx`
2. `src/domains/floor-plan/admin/EditorCanvas.tsx`
3. `src/domains/floor-plan/admin/TableRenderer.tsx`
4. `src/domains/floor-plan/admin/SeatRenderer.tsx`
5. `src/domains/floor-plan/admin/FixtureToolbar.tsx`
6. `src/domains/floor-plan/admin/TableProperties.tsx`

## Theme Type Import

At the top of each file, add:

```typescript
import type { FloorPlanTheme } from '@/lib/theme';
import { darkTheme } from '@/lib/theme';
```

## Changes Required

### 1. FloorPlanEditor.tsx

Add `theme` prop and pass it down:

```typescript
interface FloorPlanEditorProps {
  locationId: string;
  onExit?: () => void;
  theme?: FloorPlanTheme;
}

export function FloorPlanEditor({ locationId, onExit, theme = darkTheme }: FloorPlanEditorProps) {
  // ... existing code

  return (
    <div style={{ background: theme.canvasBg }}>
      {/* Pass theme to EditorCanvas */}
      <EditorCanvas
        {...otherProps}
        theme={theme}
      />

      {/* Pass theme to FixtureToolbar */}
      <FixtureToolbar
        {...toolbarProps}
        theme={theme}
      />

      {/* Pass theme to TableProperties */}
      <TableProperties
        {...propertiesProps}
        theme={theme}
      />
    </div>
  );
}
```

### 2. EditorCanvas.tsx

Add `theme` prop and apply colors:

```typescript
interface EditorCanvasProps {
  // ... existing props
  theme?: FloorPlanTheme;
}

export function EditorCanvas({ ..., theme = darkTheme }: EditorCanvasProps) {
  // Replace hardcoded colors with theme values

  // Canvas background
  const canvasStyle = {
    background: theme.canvasBg,
    border: `1px solid ${theme.canvasBorder}`,
    // Grid pattern
    backgroundImage: `radial-gradient(circle, ${theme.gridDot} 1px, transparent 1px)`,
    backgroundSize: '32px 32px',
  };

  return (
    <div style={canvasStyle}>
      {/* Pass theme to TableRenderer */}
      {tables.map(table => (
        <TableRenderer
          key={table.id}
          table={table}
          theme={theme}
          {...otherProps}
        />
      ))}
    </div>
  );
}
```

### 3. TableRenderer.tsx

Apply theme colors to table shapes:

```typescript
interface TableRendererProps {
  table: Table;
  theme?: FloorPlanTheme;
  isSelected?: boolean;
  // ... other props
}

export function TableRenderer({ table, theme = darkTheme, isSelected, ... }: TableRendererProps) {
  const fillColor = table.shape === 'circle' ? theme.tableCircleFill : theme.tableRectFill;
  const strokeColor = table.shape === 'circle' ? theme.tableCircleStroke : theme.tableRectStroke;

  const style = {
    fill: fillColor,
    stroke: strokeColor,
    strokeWidth: isSelected ? 3 : 2,
    boxShadow: isSelected ? theme.tableSelectedGlow : 'none',
  };

  // ... render table with these styles
}
```

### 4. SeatRenderer.tsx

Apply theme colors to seats:

```typescript
interface SeatRendererProps {
  seat: Seat;
  theme?: FloorPlanTheme;
  isSelected?: boolean;
  // ... other props
}

export function SeatRenderer({ seat, theme = darkTheme, isSelected, ... }: SeatRendererProps) {
  const style = {
    fill: isSelected ? theme.seatSelectedFill : theme.seatFill,
    stroke: theme.seatStroke,
    color: theme.seatText,
  };

  // ... render seat with these styles
}
```

### 5. FixtureToolbar.tsx

Apply theme to toolbar buttons:

```typescript
interface FixtureToolbarProps {
  // ... existing props
  theme?: FloorPlanTheme;
}

export function FixtureToolbar({ ..., theme = darkTheme }: FixtureToolbarProps) {
  const buttonStyle = {
    background: theme.buttonSecondary,
    border: `1px solid ${theme.panelBorder}`,
    color: theme.textMuted,
  };

  const activeButtonStyle = {
    background: theme.buttonPrimary,
    color: '#fff',
  };

  // ... apply styles to buttons
}
```

### 6. TableProperties.tsx

Apply theme to properties panel:

```typescript
interface TablePropertiesProps {
  // ... existing props
  theme?: FloorPlanTheme;
}

export function TableProperties({ ..., theme = darkTheme }: TablePropertiesProps) {
  const panelStyle = {
    background: theme.panelBg,
    border: `1px solid ${theme.panelBorder}`,
    color: theme.textPrimary,
  };

  const labelStyle = {
    color: theme.textMuted,
  };

  // ... apply styles to panel
}
```

## Color Mapping Reference

| Current Hardcoded | Theme Property |
|-------------------|----------------|
| `#0f172a`, `#1e293b` | `theme.canvasBg` |
| `rgba(255, 255, 255, 0.1)` | `theme.canvasBorder` |
| `rgba(99, 102, 241, 0.15)` | `theme.gridDot` |
| `#1e293b` (rect fill) | `theme.tableRectFill` |
| `#22c55e` (circle fill) | `theme.tableCircleFill` |
| `rgba(255, 255, 255, 0.2)` | `theme.tableRectStroke` |
| `#fff` (text) | `theme.textPrimary` |
| `#94a3b8` (muted) | `theme.textMuted` |

## Acceptance Criteria

- [ ] All components accept optional `theme` prop
- [ ] Default to `darkTheme` when no theme provided
- [ ] Canvas background uses theme colors
- [ ] Grid dots use theme color
- [ ] Tables use theme fill/stroke colors
- [ ] Seats use theme colors
- [ ] Toolbar uses theme button styles
- [ ] Properties panel uses theme colors
- [ ] Selected states use theme glow/highlight
- [ ] No TypeScript errors
- [ ] No visual regression in dark mode

## Limitations

- Do NOT change component logic
- Do NOT change API calls
- Do NOT change event handlers
- ONLY add theme prop and apply colors
- Default to dark theme for backward compatibility
