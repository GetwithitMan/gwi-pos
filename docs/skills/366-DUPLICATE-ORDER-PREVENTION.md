# Skill 366: Duplicate Order Prevention

## Status: DONE
## Domain: Orders
## Dependencies: 02 (Quick Order Entry), 07 (Send to Kitchen)

## Summary

Rapid send button taps created multiple duplicate orders because React state (`setIsSending(true)`) updates too slowly — multiple clicks enter `handleSendToKitchen` before re-render. Fixed with ref-based guard.

## Problem

3 duplicate orders created within 1 second (20:06:03-04 UTC). Each had identical items. Orders couldn't be closed because they were orphaned duplicates.

## Solution

Added `sendInProgressRef` guard at the very top of `handleSendToKitchen`, before any React state checks:

```typescript
const handleSendToKitchen = useCallback(async (employeeId?: string) => {
  if (sendInProgressRef.current) return  // Ref guard (sync, immediate)
  // ... existing checks ...
  sendInProgressRef.current = true       // Set before async work
  setIsSending(true)                     // React state (async, batched)
  // ... rest of function
```

`useRef` is synchronous and updates immediately, blocking subsequent calls in the same event loop tick. React state batches updates and doesn't re-render until the next tick.

## Key File

- `src/hooks/useActiveOrder.ts` — `handleSendToKitchen` function, `sendInProgressRef` guard
