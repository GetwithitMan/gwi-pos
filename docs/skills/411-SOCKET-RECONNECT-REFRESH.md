# Skill 411: Socket Reconnect Data Refresh

**Status:** Done
**Date:** Feb 23, 2026
**Commits:** `d1f866d`

## Problem

When a socket connection dropped and reconnected (WiFi blip, server restart), KDS and FloorPlan did not trigger a data refresh. Events missed during the disconnect were lost. Views stayed stale until the next natural socket event arrived or the 20-second fallback polling kicked in.

Additionally, the hardware health admin page (`/settings/hardware/health`) polled every 30 seconds unconditionally — the only component in the entire app without a socket-connected gate.

## Solution

### KDS Reconnect Refresh

**File:** `src/app/(kds)/kds/page.tsx`

Added `loadOrders()` call inside the existing `onConnect` handler. On reconnect, KDS immediately fetches fresh order/ticket data. Idempotent — safe on first connect too.

### FloorPlan Reconnect Refresh

**File:** `src/components/floor-plan/FloorPlanHome.tsx`

Added `wasEverConnectedRef` to track if socket was ever connected. New `useEffect` watches `isConnected` — on REconnect (not first connect), calls `loadFloorPlanData()` via `callbacksRef`. Skips initial connect since the snapshot/mount effect already handles that.

### Hardware Health Polling Gate

**File:** `src/app/(admin)/settings/hardware/health/page.tsx`

Added `useEvents({ locationId, autoConnect: true })` and gated the 30-second polling interval with `if (isConnected) return`. Matches the pattern used in every other fallback poller across the app.

## Files Modified

| File | Change |
|------|--------|
| `src/app/(kds)/kds/page.tsx` | `loadOrders()` on socket connect |
| `src/components/floor-plan/FloorPlanHome.tsx` | Reconnect-aware refresh with `wasEverConnectedRef` |
| `src/app/(admin)/settings/hardware/health/page.tsx` | `isConnected` gate on 30s polling |
