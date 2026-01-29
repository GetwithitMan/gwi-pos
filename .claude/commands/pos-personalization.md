# POS Personalization (Skill 99)

Customize the POS interface with per-employee colors and effects for categories and menu items.

## Overview

Each employee can personalize their POS view with custom colors for category buttons and menu items, plus visual effects to make frequently used items "pop".

## Category Button Colors

### Access
1. Click gear icon in POS header
2. Select "Reorder Categories"
3. Click paint icon on any category

### Customization Options

| Setting | Description |
|---------|-------------|
| Selected Background | Color when category is active |
| Selected Text | Text color when active |
| Unselected Background | Color when category is inactive |
| Unselected Text | Text color when inactive |

### Example
Make "Cocktails" pop with a bright gradient when selected:
- Selected BG: `#3B82F6` (blue)
- Selected Text: `#FFFFFF` (white)
- Unselected BG: `#DBEAFE` (light blue)
- Unselected Text: `#1E40AF` (dark blue)

## Menu Item Styling

### Access
1. Click gear icon in POS header
2. Select "Customize Item Colors"
3. Click paint icon on any menu item

### Customization Options

| Setting | Description |
|---------|-------------|
| Background Color | Item button background |
| Text Color | Item name color |
| Pop Effect | Visual effect (Glow, Larger, Border, All) |
| Effect Color | Color for glow/border effect |

### Pop Effects

| Effect | Description |
|--------|-------------|
| Glow | Soft glow shadow around item |
| Larger | Slightly larger button size |
| Border | Colored border around item |
| All | All effects combined (maximum pop!) |

## Reset Options

In the gear dropdown:
- **Reset All Category Colors** - Clear all category customizations
- **Reset All Item Styles** - Clear all menu item customizations

## Storage

Settings stored in `Employee.posLayoutSettings` JSON field:

```json
{
  "categoryColors": {
    "cat-cocktails": {
      "selectedBg": "#3B82F6",
      "selectedText": "#FFFFFF",
      "unselectedBg": "#DBEAFE",
      "unselectedText": "#1E40AF"
    }
  },
  "menuItemColors": {
    "item-margarita": {
      "backgroundColor": "#FEF3C7",
      "textColor": "#92400E",
      "popEffect": "glow",
      "effectColor": "#F59E0B"
    }
  }
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(pos)/orders/page.tsx` | Main POS with personalization |
| `src/components/pos/CategoryColorModal.tsx` | Category color picker |
| `src/components/pos/MenuItemColorModal.tsx` | Item style picker |
| `src/app/api/employees/[id]/layout/route.ts` | Save settings API |
