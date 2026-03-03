# Skill 476 — CFD Suggested Items (Phase 5)

**Date:** 2026-03-02
**Repos affected:** `gwi-pos`, `gwi-cfd`
**Commits:**
- `8b04893` (POS) — add isFeaturedCfd to MenuItem + featured items API
- `bf4981d` (CFD) — add suggested items section to CfdOrderScreen

---

## What Was Done

Added a "Suggested Items" section to the Customer Facing Display order screen. Owners mark menu items as CFD-featured in the admin UI; the CFD app fetches and displays them as a horizontal scrollable row with images.

### POS — Schema

```prisma
model MenuItem {
  // ... existing fields
  isFeaturedCfd  Boolean  @default(false)
}
```

### POS — API

**`GET /api/cfd/featured-items`:**
- Query: `MenuItem.findMany({ where: { isFeaturedCfd: true, deletedAt: null, locationId } })`
- Returns: `{ items: [{ id, name, imageUrl }] }`
- Location-scoped via session/auth context

### CFD — CfdOrderScreen (`gwi-cfd`)

**`FeaturedItemCard` composable:**
- Rounded card with Coil `AsyncImage` (menu item photo) + item name label
- Fixed width card in a horizontal `LazyRow`
- Placeholder/fallback when no image URL

**Data loading:**
- OkHttp `GET /api/cfd/featured-items` fires when socket connects (has NUC base URL + auth)
- Results stored in `CfdViewModel` state
- LazyRow renders below the order items list under a "Suggested Items" header

---

## Architecture

```
gwi-pos (NUC)                          gwi-cfd (PAX A3700)
┌──────────────────────┐               ┌──────────────────────────┐
│ MenuItem.isFeaturedCfd│               │ CfdOrderScreen           │
│                      │  GET /api/cfd/ │  ├── Order items list    │
│ GET /api/cfd/        │◄──────────────│  └── Suggested Items     │
│   featured-items     │───────────────►│      LazyRow of          │
│                      │  JSON response │      FeaturedItemCard    │
└──────────────────────┘               └──────────────────────────┘
```

The suggested items are display-only on the CFD — tapping them does nothing. They serve as upsell prompts while the customer watches their order being built.
