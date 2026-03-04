# Flow: [Flow Name]

> **When to read this:** Before changing any feature listed in §8 Dependencies. If your change touches this journey, read this doc first.

---

## 1. Purpose

**Trigger:** What user action or system event starts this flow.

**Why it matters:** Which integrity concern this protects — money integrity / kitchen integrity / reporting integrity / sync integrity.

**Scope:** Which repos and clients are involved.

---

## 2. Preconditions

| Precondition | Detail |
|-------------|--------|
| Feature flags / settings | e.g., `dualPricingEnabled`, `safEnabled` |
| Hardware required | e.g., Datacap reader, receipt printer |
| Permissions required | e.g., `ORDERS_CREATE`, `PAYMENTS_PROCESS` |
| Online / offline state | e.g., "NUC must be reachable" or "works fully offline" |
| Prior state | e.g., "An open order must exist", "Shift must be open" |

---

## 3. Sequence (Happy Path)

Layers: **Client → API → Events → Snapshot → Broadcast → Side Effects**

```
1. [CLIENT]        User action or trigger
2. [API]           Route called: METHOD /api/route
3. [DB]            Record created/updated
4. [EVENTS]        emitOrderEvent('event:type', payload)
5. [SNAPSHOT]      Snapshot rebuilt from events
6. [BROADCAST]     emitToLocation('socket:event', payload)
7. [SIDE EFFECTS]  Print / KDS update / Neon sync / CFD update
```

Replace the above with numbered steps specific to this flow. Be explicit about which layer each step happens in.

---

## 4. Events Emitted

| Event Name | Payload (key fields) | Emitter | Consumers | Ordering Constraint |
|------------|---------------------|---------|-----------|---------------------|
| `event:type` | `{ id, locationId, ... }` | POS API | Android, KDS, CFD | Must follow step N |

---

## 5. State Changes

| Record | Fields Changed | When |
|--------|---------------|------|
| `Order` | `status`, `updatedAt` | Step N |
| `OrderSnapshot` | Full rebuild | After event emitted |
| `Payment` | `status`, `settledAt` | Step N |

**Snapshot rebuild points:** List steps where `OrderSnapshot` is rebuilt.

---

## 6. Edge Cases

| Scenario | Behavior |
|----------|---------|
| **Offline** | Describe outbox/SAF behavior |
| **Partial failure** | e.g., payment succeeds but printer fails |
| **Retry / idempotency** | How duplicate requests are handled |
| **Reconnect race** | What happens if socket reconnects mid-flow |
| **Permission denied** | What the client sees |

---

## 7. Invariants (Never Break These)

These must hold after every change to this flow:

- **[INVARIANT-1]** Plain-English statement of what must always be true.
- **[INVARIANT-2]** ...
- **[INVARIANT-3]** ...

If you break an invariant, the fix is: [describe compensating action].

---

## 8. Dependencies & Cross-Refs

> If you touch this flow, also check these docs:

| Doc | Why |
|-----|-----|
| `docs/features/[feature].md` | Describes the feature this flow passes through |
| `docs/guides/[guide].md` | Rules that govern this flow |
| `docs/flows/[flow].md` | Related flow that shares state/events |

### Features Involved
- [Feature 1] — role in this flow
- [Feature 2] — role in this flow

---

*Last updated: YYYY-MM-DD*
