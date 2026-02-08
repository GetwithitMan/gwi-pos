---
skill: 233
title: Modifier Depth Indentation
status: DONE
depends_on: [123]
---

# Skill 233: Modifier Depth Indentation

> **Status:** DONE
> **Domain:** Menu
> **Dependencies:** 123 (Menu Builder Child Modifiers)
> **Last Updated:** 2026-02-07

## Overview

Depth-based visual rendering of nested modifiers in OrderPanel, with connector arrows and pre-modifier color labels. Top-level modifiers show a bullet prefix; child modifiers show an arrow prefix with progressive indentation.

## How It Works

Each `OrderItemModifier` carries a `depth` field (0 = top-level, 1 = child, 2 = grandchild, etc.). The OrderPanelItem component uses this to render:

- **Depth 0**: `• Modifier Name` (12px text, slate-400)
- **Depth 1+**: `↳ Modifier Name` (11px text, slate-500, indented 20px per depth level)

### Pre-Modifier Color Labels

When a modifier has a `preModifier` value, it renders with a colored prefix:

| Pre-Modifier | Color | Example |
|-------------|-------|---------|
| `no` | Red (`text-red-400`) | NO Ranch |
| `extra` | Amber (`text-amber-400`) | EXTRA Cheese |
| `lite`, `light`, `side` | Blue (`text-blue-400`) | LITE Mayo |

### Depth Computation

The `useOrderPanelItems` hook maps the `depth` field from `OrderItemModifier` records. The depth is computed server-side when modifiers are saved, using `childToParentGroupId` to walk the parent chain and count nesting levels.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/orders/OrderPanelItem.tsx` | Rendering logic (lines ~521-543) -- indent, prefix, pre-modifier colors |
| `src/hooks/useOrderPanelItems.ts` | Maps `depth` and `preModifier` from store to panel data |
| `src/stores/order-store.ts` | Stores `depth` and `preModifier` on modifier objects |

## Connected Parts

- **Menu Builder Child Modifiers (Skill 123/129)**: Creates the nested modifier structure that produces depth > 0
- **Shared OrderPanel Items Hook (Skill 234)**: Consolidates depth mapping across all views
- **KDS Display (Skill 23)**: Uses dash-prefix display (`- Mod`, `-- Child`) for depth on kitchen tickets

## Indentation Formula

```
indent = 8 + (depth * 20) pixels
```

At depth 0: 8px base indent with `•` prefix
At depth 1: 28px indent with `↳` prefix
At depth 2: 48px indent with `↳` prefix
