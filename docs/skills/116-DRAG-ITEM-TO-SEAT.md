# Skill 116: Drag Item to Seat

## Status: TODO (Low Priority - Nice to Have)

## Overview

Allow servers to drag order items from the order panel directly onto seat dots on the floor plan to reassign items between seats. Useful in high-volume environments where servers tap multiple items quickly and then distribute them.

## The Problem

Current workflow:
1. Tap seat 1
2. Add 3 items
3. Tap seat 2
4. Add 2 items
5. Realize item 2 should be on seat 3
6. Have to delete item, tap seat 3, re-add item

Proposed workflow:
1. Add all items quickly (no seat selection)
2. Drag items onto seats to assign
3. Or drag items between seats to reassign

## Implementation Ideas

### Idea 1: Drag from Order Panel to Floor Plan
- Make order items draggable (react-dnd or framer-motion drag)
- Seat dots become drop targets when dragging
- On drop: Update item's `seatNumber` in local state
- Visual: Ghost image follows cursor, seats glow when valid target

**Pros:** Intuitive, visual
**Cons:** Requires precise targeting on small seat dots

### Idea 2: "Assign Mode" Toggle
- Button in order panel: "Assign Items"
- Enters mode where tapping item then tapping seat assigns it
- Exit mode when done

**Pros:** Works on touch devices, no drag precision needed
**Cons:** Extra mode to manage, less intuitive

### Idea 3: Long-press Item → Seat Picker
- Long-press item in order panel
- Popup shows seat grid (1-12 or however many)
- Tap seat number to assign

**Pros:** Works everywhere, no drag needed
**Cons:** Extra tap, popup interrupts flow

### Idea 4: Swipe Gesture
- Swipe item left/right to cycle through seats
- Visual indicator shows current seat assignment
- Swipe past last seat = "No seat"

**Pros:** Fast, touch-native
**Cons:** Might conflict with other swipe actions

## Technical Considerations

### Coordinates
- Seat dots already have screen coordinates (`seat.x`, `seat.y`)
- Order panel items need drag handlers
- Need hit detection: Is cursor within 30px of a seat dot?

### State Update
```typescript
// On drop
setInlineOrderItems(prev =>
  prev.map(item =>
    item.id === draggedItemId
      ? { ...item, seatNumber: targetSeatNumber }
      : item
  )
)
```

### Visual Feedback
- Dragging item: Semi-transparent, follows cursor
- Valid drop target: Seat glows green
- Invalid drop: Red outline or shake animation

## Dependencies

- Skill 11: Seat Tracking (seat data structure)
- Skill 106: Interactive Floor Plan (seat coordinates)

## Questions to Consider

1. Should unassigned items go to a "No Seat" section?
2. What happens when dragging to a seat on a different table in a combined group?
3. Should this work on mobile/tablet touch screens?
4. Does this conflict with any existing drag behaviors?

## Priority

Low - Current tap-to-assign workflow works fine for most use cases. This is a power-user optimization for very high-volume environments.
