# Hardware Domain Changelog

## Cross-Domain Update: Feb 6, 2026 — Per-Modifier Print Routing (from Menu Domain)

### What Happened

During PM Mode: Menu session, **Skill 212: Per-Modifier Print Routing** was implemented. This adds admin UI and API support for routing individual modifiers to specific printers.

### Impact on Hardware Domain

The `Modifier` model now has **active, configured data** in two fields that were previously dormant:

```prisma
model Modifier {
  printerRouting  String   @default("follow")  // "follow" | "also" | "only"
  printerIds      Json?                         // Array of printer IDs
}
```

### What Was Done (Menu Domain — Skill 212)

| Layer | What | Status |
|-------|------|--------|
| **Admin UI** | 🖨️ button on each modifier row in ItemEditor | ✅ Done |
| **API (GET)** | Returns `printerRouting` + `printerIds` per modifier | ✅ Done |
| **API (POST/PUT)** | Accepts `printerRouting` + `printerIds` | ✅ Done |
| **Print Dispatch** | Integration with actual ticket printing | ❌ NOT done — Hardware domain |

### What Hardware Domain Needs to Do

**When implementing Skill 103 Phase 3 (Print Dispatch Integration):**

1. **Resolve modifier-level routing** after item-level routing:
   ```
   For each OrderItem in the order:
     1. Resolve item's printer(s) via existing priority chain
     2. For each OrderItemModifier:
        a. Look up source Modifier record
        b. Check printerRouting:
           - "follow" → modifier goes wherever item goes (default, no action)
           - "also" → send to item's printer(s) AND modifier.printerIds
           - "only" → send ONLY to modifier.printerIds (NOT item's printer)
     3. Group all print targets, build tickets per printer
   ```

2. **Updated routing priority:**
   ```
   1. PrintRoute (by priority) — Named routes
   2. Modifier.printerRouting — Per-modifier override ("also"/"only")
   3. Item.printerIds — Per-item override
   4. Category.printerIds — Category-level
   5. Default kitchen printer — Fallback
   ```

3. **Ticket formatting consideration:**
   - When a modifier routes to a DIFFERENT printer than its parent item, the ticket should include context: "FOR: Classic Burger" so the station knows what the modifier belongs to
   - Example: "Add Espresso Shot" routes to Bar Printer → ticket shows "FOR: Surf & Turf Dinner"

### Files to Reference

| File | What It Does |
|------|-------------|
| `docs/skills/212-PER-MODIFIER-PRINT-ROUTING.md` | Full skill documentation |
| `src/components/menu/ItemEditor.tsx` | Admin UI (🖨️ button, dropdown) |
| `src/app/api/menu/items/[id]/modifier-groups/[groupId]/modifiers/route.ts` | API reads/writes routing fields |
| `docs/skills/103-PRINT-ROUTING.md` | Existing print routing skill (needs Phase 3) |

### Skill 103 Checklist Update

Phase 2 remains TODO. Phase 3 now has additional requirement:

```
### Phase 3: Integration (TODO — UPDATED)
- [ ] Update kitchen print to check PrintRoutes first
- [ ] **NEW: Check Modifier.printerRouting for per-modifier routing**
- [ ] Apply RouteSpecificSettings to ticket builder
- [ ] Add print job logging
- [ ] Implement failover logic
- [ ] **NEW: Context line on modifier-only tickets ("FOR: {item name}")**
```

---

## 2026-02-10 — Browser Compatibility: oklch() Transpilation

### Impact on Hardware Domain
KDS devices with older Chrome versions (< 111) cannot render `oklch()` CSS color values used by Tailwind CSS v4. This was discovered on a KA-15PCAPAIO4 device running Chrome 108.

### Fix Applied (in PostCSS pipeline)
`@csstools/postcss-oklab-function` with `preserve: false` transpiles all `oklch()` → `rgb()`. This affects ALL pages (not just KDS), ensuring hardware devices with older browsers can render the UI.

### Hardware Considerations
- KDS devices often run older Android/Chrome versions that don't auto-update
- The `browserslist` in `package.json` now targets `chrome >= 108` as minimum
- Any new CSS features should be tested against Chrome 108 as the floor
- Consider adding browser version to the KDS screen admin page for visibility

### Files Modified (by KDS Domain PM)
- `postcss.config.mjs` — oklch transpilation plugin
- `package.json` — browserslist + dependency

---

### How to Resume
1. Say: `PM Mode: Hardware`
2. Review this changelog
3. Review Skill 103 (Print Routing) — Phase 2 + Phase 3
4. Review Skill 212 (Per-Modifier Print Routing) for new requirements
