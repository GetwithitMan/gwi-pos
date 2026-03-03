# Skill 477 — CFD Back-Office Admin Page (Phase 6)

**Date:** 2026-03-02
**Repo affected:** `gwi-pos`
**Commit:** `3a9e885` — add CFD settings admin page with featured items management

---

## What Was Done

Created a dedicated CFD management page in the admin back-office at `/settings/hardware/cfd`. Owners can view paired CFD devices, adjust display settings, and pick which menu items appear as suggested items on the customer-facing display.

### Admin Page (`/settings/hardware/cfd`)

Three sections:

#### 1. Paired Devices

- Lists all terminals where `category = CFD_DISPLAY`
- Shows: terminal name, paired register, serial number (`cfdSerialNumber` from Skill 475), connection status
- Links to individual terminal settings

#### 2. Display Settings Form

- **Tip mode:** preset buttons vs custom entry vs both
- **Signature threshold:** dollar amount above which signature is required
- **Idle promo:** enable/disable + welcome text for idle screen
- **Receipt options:** email, SMS, print toggles
- **Timeout settings:** seconds before auto-idle after approval/decline

Maps to the existing `CfdSettings` model (created in Skill 461).

#### 3. Featured Items Picker

- Grid of all active menu items with checkboxes
- Checked = `isFeaturedCfd: true` (appears on CFD suggested items row)
- Each toggle fires `PATCH /api/menu/items/[id]` with `{ isFeaturedCfd: boolean }`
- Visual preview of how many items are currently featured

### API

**`PATCH /api/menu/items/[id]`:**
- Accepts `{ isFeaturedCfd: boolean }` in the request body
- Updates the single field on the MenuItem
- Returns the updated item

---

## Navigation

Added to the admin settings nav under **Hardware** section, alongside existing pages for payment readers and KDS devices.

```
/settings/hardware/
  ├── payment-readers   (Skill 120)
  ├── kds               (Skill 102)
  └── cfd               (Skill 477)  ← NEW
```
