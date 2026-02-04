# Seat Positioning Guide

Visual reference for how seats are positioned around different table shapes.

---

## Coordinate System

- **Origin (0, 0):** Table center
- **Units:** Feet
- **Clearance:** 1.5 feet from table edge
- **Angle:** Degrees, where 0° = up, 90° = right, 180° = down, 270° = left

---

## Round Table (8 Seats)

```
          Seat 1
     (-0, -4.5, 180°)
           ↓

  Seat 8         Seat 2
(-4.5, 0, 90°) → ● ← (4.5, 0, 270°)

  Seat 7         Seat 3
           ↑
      Seat 6   Seat 5
           Seat 4
      (0, 4.5, 0°)
```

**Math:**
- Radius: `(width/2 + 1.5)` feet
- Start angle: -90° (top)
- Angular spacing: `360° / 8 = 45°`
- Position: `(radius * cos(angle), radius * sin(angle))`
- Facing angle: `angle + 180°` (face center)

**Example (4ft diameter table):**
- Seat 1: `(0, -3.5)` @ 180° (top, facing down)
- Seat 2: `(2.47, -2.47)` @ 225° (top-right, facing center)
- Seat 3: `(3.5, 0)` @ 270° (right, facing left)
- Seat 4: `(2.47, 2.47)` @ 315° (bottom-right, facing center)
- Seat 5: `(0, 3.5)` @ 0° (bottom, facing up)
- Seat 6: `(-2.47, 2.47)` @ 45° (bottom-left, facing center)
- Seat 7: `(-3.5, 0)` @ 90° (left, facing right)
- Seat 8: `(-2.47, -2.47)` @ 135° (top-left, facing center)

---

## Rectangle Table (6 Seats)

```
Table: 6ft x 4ft

      Seat 1      Seat 2
     (-2, -3.5)  (2, -3.5)
         ↓          ↓

Seat 6           ████████████           Seat 3
(-4.5, 0) →      ████████████      ← (4.5, 0)
                 ████████████
         ↑          ↑
      Seat 5      Seat 4
     (-2, 3.5)   (2, 3.5)
```

**Math:**
- Perimeter: `2 * (width + height) = 20ft`
- Seats per side (proportional):
  - Top: `(width / perimeter) * count = (6/20) * 6 = 2 seats`
  - Right: `(height / perimeter) * count = (4/20) * 6 = 1 seat`
  - Bottom: `2 seats`
  - Left: `1 seat`

**Spacing on each edge:**
- Top (2 seats): Divide width into 3 sections (edges + gap)
  - Seat 1: `x = -6/2 + (6/3)*1 = -1`
  - Seat 2: `x = -6/2 + (6/3)*2 = 1`
- Right (1 seat): Center of right edge
  - Seat 3: `y = 0` (centered)
- Bottom (2 seats): Same as top, mirrored
- Left (1 seat): Center of left edge

**Angles:**
- Top seats: 180° (facing down)
- Right seats: 270° (facing left)
- Bottom seats: 0° (facing up)
- Left seats: 90° (facing right)

---

## Booth Table (4 Seats, Front Only)

```
Table: 6ft x 4ft

████████████████
████████████████  ← Back wall (no seats)
████████████████

  Seat 1   Seat 2   Seat 3   Seat 4
  (-3, 3.5) (-1, 3.5) (1, 3.5) (3, 3.5)
     ↑        ↑        ↑        ↑
  (all facing up toward table)
```

**Math:**
- All seats on front side only
- Y position: `height/2 + clearance = 2 + 1.5 = 3.5`
- X spacing: Divide width into `count + 1` sections
  - Seat 1: `x = -6/2 + (6/5)*1 = -1.8`
  - Seat 2: `x = -6/2 + (6/5)*2 = -0.6`
  - Seat 3: `x = -6/2 + (6/5)*3 = 0.6`
  - Seat 4: `x = -6/2 + (6/5)*4 = 1.8`
- All angles: 0° (facing up)

---

## Oval Table (Same as Round)

Oval tables use the same circular distribution as round tables, but with different X and Y radii:

```
      Seat 1
        ↓

Seat 4  ◯◯◯◯◯◯  Seat 2
   →    ◯◯◯◯◯◯  ←
        ◯◯◯◯◯◯
        ↑
      Seat 3
```

**Math:**
- X radius: `width/2 + 1.5`
- Y radius: `height/2 + 1.5`
- Position: `(radiusX * cos(angle), radiusY * sin(angle))`

---

## Square Table (4 Seats, 4ft x 4ft)

```
      Seat 1
     (0, -3.5)
        ↓

Seat 4    ████    Seat 2
(-3.5, 0) ████  (3.5, 0)
   →      ████      ←

        ↑
      Seat 3
     (0, 3.5)
```

**Math:**
- One seat per side (centered)
- Clearance: 1.5ft from edge
- Positions:
  - Top: `(0, -height/2 - 1.5)` @ 180°
  - Right: `(width/2 + 1.5, 0)` @ 270°
  - Bottom: `(0, height/2 + 1.5)` @ 0°
  - Left: `(-width/2 - 1.5, 0)` @ 90°

---

## Hexagon Table (6 Seats)

```
        Seat 1
          ↓

Seat 6      ⬡      Seat 2
   →      ⬡   ⬡      ←
        ⬡       ⬡
Seat 5  ⬡       ⬡  Seat 3
          ⬡   ⬡
    ↑     ⬡⬡⬡    ↑
  Seat 4      (implied)
```

Uses circular distribution like round tables. Perfect for 6 seats (one at each vertex).

---

## Virtual Seats

Virtual seats are added during service when more guests arrive than originally planned.

**Placement Strategy (Current):**
```
Existing:  ● ● ● ●
Virtual:         ● V  ← Placed offset from last seat
```

**Visual Indicators:**
- Dashed border (strokeDasharray: "4,2")
- Yellow "V" badge in top-right corner
- Same size and positioning as regular seats

**Future Enhancement:**
Could use gap detection to place virtual seats in largest empty space:
```
● ● ● ● ● ●     →     ● ● V ● ● ● V ●
  (gap here)          (fills gaps)
```

---

## Seat States

### Visual Appearance

**Empty Seat:**
```
  ┌─────┐
  │  1  │  ← Gray border, white fill, seat number
  └─────┘
```

**Occupied Seat:**
```
  ┌─────┐
  │  A  │  ← Blue fill, white text, guest initial
  └─────┘
```

**Selected Seat:**
```
   ╔═══╗
  ┌─────┐
  │  1  │  ← Blue glow ring (4px wider)
  └─────┘
   ╚═══╝
```

**Virtual Seat:**
```
  ┌ ─ ─ ┐
  │  V  │  ← Dashed border, "V" badge
  └ ─ ─ ┘
```

---

## Common Configurations

### Small Table (2-4 seats)
- **2 seats:** Opposite sides (0° and 180°)
- **4 seats:** Cardinal directions (0°, 90°, 180°, 270°)

### Medium Table (6-8 seats)
- **6 seats:** Every 60° around circle
- **8 seats:** Every 45° around circle

### Large Table (10-12 seats)
- **10 seats:** Every 36° around circle
- **12 seats:** Every 30° around circle

### Booth Configuration
- **2-4 seats:** Front side only
- **6-8 seats:** Could use L-shape (2 sides) - future enhancement

---

## Merge Behavior

When tables merge, seats are renumbered sequentially:

**Before Merge:**
```
Table 1:  ● ● ● ●        Table 2:  ● ● ● ● ●
          1 2 3 4                  1 2 3 4 5
```

**After Merge:**
```
Combined:  ● ● ● ● ● ● ● ● ●
           1 2 3 4 5 6 7 8 9
```

Seat positions remain unchanged, only the `seatNumber` field is updated.

---

## Coordinate Examples

### 4ft Round Table, 4 Seats

| Seat | offsetX | offsetY | angle | Position |
|------|---------|---------|-------|----------|
| 1    | 0.00    | -3.50   | 180°  | Top      |
| 2    | 3.50    | 0.00    | 270°  | Right    |
| 3    | 0.00    | 3.50    | 0°    | Bottom   |
| 4    | -3.50   | 0.00    | 90°   | Left     |

### 6ft x 4ft Rectangle, 6 Seats

| Seat | offsetX | offsetY | angle | Position      |
|------|---------|---------|-------|---------------|
| 1    | -2.00   | -3.50   | 180°  | Top-left      |
| 2    | 2.00    | -3.50   | 180°  | Top-right     |
| 3    | 4.50    | 0.00    | 270°  | Right-center  |
| 4    | 2.00    | 3.50    | 0°    | Bottom-right  |
| 5    | -2.00   | 3.50    | 0°    | Bottom-left   |
| 6    | -4.50   | 0.00    | 90°   | Left-center   |

---

## Implementation Notes

1. **Floating Point Precision**
   - All positions rounded to 2 decimal places
   - Angles rounded to 1 decimal place
   - Prevents floating-point drift in UI

2. **Clearance Constant**
   - 1.5 feet standard clearance
   - Matches typical restaurant spacing
   - Could be configurable per venue in future

3. **Angle Convention**
   - 0° = facing up (north)
   - Increases clockwise
   - Matches SVG transform rotate convention

4. **Table Rotation**
   - Seats rotate with table
   - Positions are relative to table center
   - SVG transforms handle the rotation
