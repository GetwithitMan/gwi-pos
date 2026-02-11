# Skill 286: Tip Bank Team Pools (Admin-Defined Tip Group Templates)

**Domain:** Tips & Tip Bank
**Status:** DONE
**Date:** 2026-02-11
**Dependencies:** 250, 252, 265

---

## Overview

Admin-defined tip group templates that employees select at clock-in. Instead of ad-hoc bartender-created groups, managers pre-configure team pools (e.g., "Bar Team", "Upstairs Servers") with role eligibility rules. Employees are automatically assigned to the template's runtime group when they clock in.

---

## How It Works

### Admin Configuration Flow

1. Manager opens **Settings > Tips** (`/settings/tips`)
2. Scrolls to "Tip Group Teams" section
3. Creates templates with:
   - **Name** — e.g., "Bar Team", "Upstairs Servers"
   - **Default Split Mode** — Equal, Hours-Weighted, or Role-Weighted
   - **Allowed Roles** — Which roles can join (empty = all roles)
   - **Active** toggle — Show/hide in clock-in picker
4. Configures global settings:
   - **Table Tip Ownership Mode** — ITEM_BASED vs PRIMARY_SERVER_OWNS_ALL
   - **Allow Standalone Servers** — Employees can opt out of group pooling
   - **Allow Employee-Created Groups** — Ad-hoc group creation on `/crew/tip-group`

### Clock-In Flow

```
Employee taps "Clock In"
    ↓
Role picker (if multi-role)
    ↓
Fetch eligible templates for employee's role
    ↓ (if templates exist)
Show Group Picker Dialog:
  [Bar Team]  [Upstairs Servers]  [No Group]
    ↓
Employee selects "Bar Team"
    ↓
assignEmployeeToTemplateGroup():
  1. Enforce single-group invariant (not already in a group)
  2. Find or create runtime TipGroup for template
  3. Add employee as member → new segment with recalculated splits
    ↓
TimeClockEntry created with selectedTipGroupId
    ↓
"Clocked in successfully — joined Bar Team"
```

### Runtime Group Lifecycle

When the first employee selects a template at clock-in:
1. System creates a **runtime TipGroup** linked to the template via `templateId`
2. First member gets 100% split in initial segment

When subsequent employees clock in and select the same template:
1. System finds the existing active runtime group
2. Adds employee via `addMemberToGroup()` → closes current segment, creates new one with recalculated splits

When employees clock out or leave the group:
- Normal group membership management applies (Skill 252)
- Last member leaving closes the runtime group
- Next clock-in will create a new runtime group for that template

### Table Tip Ownership Modes

| Mode | Behavior | Best For |
|------|----------|----------|
| `ITEM_BASED` | Helpers get per-item credit via co-ownership (Skill 253) | Restaurants with co-servers |
| `PRIMARY_SERVER_OWNS_ALL` | Primary server gets 100% of dine-in tips, helpers paid via tip-out rules only | Bars, simple setups |

When `PRIMARY_SERVER_OWNS_ALL` is active:
- The `allocateTipsForOrder()` pipeline checks ownership
- If the order has a `tableId` and multiple owners, ownership splits are **skipped**
- The primary server (order creator) gets the full tip
- Helpers are compensated via role tip-out rules at shift closeout

### Standalone Servers

When `allowStandaloneServers = true`:
- "No Group" option appears in the clock-in group picker
- Employee's tips go as DIRECT_TIP to their personal ledger (no pooling)
- Default behavior — most servers work standalone

When `allowStandaloneServers = false`:
- "No Group" option is hidden at clock-in
- All employees with eligible templates must pick a group

### Ad-Hoc Group Controls

When `allowEmployeeCreatedGroups = true`:
- `/crew/tip-group` page shows "Start New Group" button
- Employees can create groups outside admin templates

When `allowEmployeeCreatedGroups = false`:
- "Start New Group" button is hidden
- Info card shows "Teams Managed by Admin"
- Only admin-defined templates are available

---

## Schema Changes

### New Model: TipGroupTemplate

```prisma
model TipGroupTemplate {
  id               String    @id @default(cuid())
  locationId       String
  location         Location  @relation(fields: [locationId], references: [id])
  name             String
  allowedRoleIds   Json      @default("[]")  // String[] of role IDs
  defaultSplitMode String    @default("equal")
  active           Boolean   @default(true)
  sortOrder        Int       @default(0)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  deletedAt        DateTime?
  syncedAt         DateTime?

  groups           TipGroup[]

  @@index([locationId])
}
```

### Modified Models

| Model | Change | Purpose |
|-------|--------|---------|
| `TipGroup` | +`templateId` + relation to TipGroupTemplate | Links runtime group to admin template |
| `TimeClockEntry` | +`selectedTipGroupId` | Tracks which runtime group was joined at clock-in |
| `Location` | +`tipGroupTemplates` reverse relation | List templates for a location |

### New Settings Fields (TipBankSettings)

```typescript
interface TipBankSettings {
  // ... existing fields ...
  tableTipOwnershipMode: 'ITEM_BASED' | 'PRIMARY_SERVER_OWNS_ALL'  // Default: 'ITEM_BASED'
  allowStandaloneServers: boolean   // Default: true
  allowEmployeeCreatedGroups: boolean  // Default: true
}
```

---

## API Routes

### Template CRUD

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tips/group-templates` | `tips.manage_rules` | List all templates for a location |
| POST | `/api/tips/group-templates` | `tips.manage_rules` | Create a new template |
| GET | `/api/tips/group-templates/[id]` | `tips.manage_rules` | Get single template |
| PUT | `/api/tips/group-templates/[id]` | `tips.manage_rules` | Update template |
| DELETE | `/api/tips/group-templates/[id]` | `tips.manage_rules` | Soft delete template |

### Eligible Templates (Clock-In)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tips/group-templates/eligible` | None | Get templates eligible for employee's role + standalone setting |

**Query params:** `locationId`, `employeeId`

**Response:**
```json
{
  "templates": [
    { "id": "tpl-1", "name": "Bar Team", "defaultSplitMode": "equal" },
    { "id": "tpl-2", "name": "Upstairs Servers", "defaultSplitMode": "role_weighted" }
  ],
  "allowStandaloneServers": true
}
```

### Time Clock Integration

**POST `/api/time-clock`** now accepts:
```json
{
  "locationId": "...",
  "employeeId": "...",
  "selectedTipGroupTemplateId": "tpl-1"
}
```

**Response** includes:
```json
{
  "id": "entry-1",
  "employeeId": "...",
  "clockIn": "2026-02-11T17:00:00.000Z",
  "message": "Clocked in successfully",
  "selectedTipGroup": {
    "id": "group-runtime-1",
    "name": "Bar Team"
  }
}
```

---

## Domain Logic

### File: `src/lib/domain/tips/tip-group-templates.ts`

| Function | Purpose |
|----------|---------|
| `getEligibleTemplates(locationId, roleId)` | Queries active templates, filters by role in `allowedRoleIds` |
| `getOrCreateGroupForTemplate(templateId, locationId)` | Finds existing active TipGroup for template or creates new one |
| `assignEmployeeToTemplateGroup({ employeeId, templateId, locationId })` | Enforces single-group invariant, finds/creates runtime group, manages membership + segments |

### Allocation Changes: `src/lib/domain/tips/tip-allocation.ts`

Added `PRIMARY_SERVER_OWNS_ALL` mode check:

```typescript
// Inside allocateTipsForOrder():
if (tableTipOwnershipMode === 'PRIMARY_SERVER_OWNS_ALL') {
  if (order?.tableId && ownership?.owners?.length > 1) {
    skipOwnership = true  // Primary server gets full tip
  }
}
```

---

## UI Changes

### Settings Page (`/settings/tips`)

**Section 8: Tip Group Teams**
- Template list with name, split mode, allowed roles, active toggle
- Add/Edit modal with form fields
- Delete with soft delete
- Fetches roles from `/api/roles` for multi-select dropdown

**New Toggles in Tip Bank section:**
- **Table Tip Ownership Mode** — Two-card selector: ITEM_BASED vs PRIMARY_SERVER_OWNS_ALL
- **Allow Standalone Servers** — Toggle
- **Allow Employee-Created Groups** — Toggle

### Crew Page (`/crew`)

**Group Picker Dialog at Clock-In:**
- Dark glassmorphism modal
- Shows eligible template buttons
- "No Group" option (when `allowStandaloneServers = true`)
- Flow: Clock In → Role picker → Group picker → API call

### Tip Group Page (`/crew/tip-group`)

- Respects `allowEmployeeCreatedGroups` setting
- Hides "Start New Group" button when disabled
- Shows info card: "Teams Managed by Admin" when disabled

---

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/domain/tips/tip-group-templates.ts` | Domain logic (3 exported functions) |
| `src/app/api/tips/group-templates/route.ts` | GET (list) + POST (create) |
| `src/app/api/tips/group-templates/[id]/route.ts` | GET + PUT + DELETE |
| `src/app/api/tips/group-templates/eligible/route.ts` | GET eligible for clock-in |

## Files Modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | TipGroupTemplate model, TipGroup.templateId, TimeClockEntry.selectedTipGroupId |
| `src/lib/settings.ts` | 3 new TipBankSettings fields + defaults |
| `src/lib/domain/tips/tip-allocation.ts` | PRIMARY_SERVER_OWNS_ALL mode check |
| `src/app/api/time-clock/route.ts` | Accept selectedTipGroupTemplateId, call assignEmployeeToTemplateGroup |
| `src/app/(admin)/settings/tips/page.tsx` | Template CRUD UI + 3 new toggles |
| `src/app/(pos)/crew/page.tsx` | Group Picker Dialog at clock-in |
| `src/app/(pos)/crew/tip-group/page.tsx` | Respect allowEmployeeCreatedGroups |

---

## Fire-and-Forget Pattern

Group assignment at clock-in is wrapped in try/catch so clock-in always succeeds:

```typescript
// In POST /api/time-clock
if (selectedTipGroupTemplateId) {
  try {
    const groupInfo = await assignEmployeeToTemplateGroup({...})
    await db.timeClockEntry.update({ data: { selectedTipGroupId: groupInfo.id } })
    selectedTipGroup = { id: groupInfo.id, name: template.name }
  } catch (err) {
    console.warn('[time-clock] Tip group assignment failed (clock-in still succeeds):', err)
  }
}
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Employee already in a group | `assignEmployeeToTemplateGroup` throws `EMPLOYEE_ALREADY_IN_GROUP`, clock-in still succeeds |
| No eligible templates for role | Group picker dialog skipped, clock in proceeds normally |
| Template deactivated mid-day | Existing runtime groups continue, no new members can join via that template |
| Empty `allowedRoleIds` | All roles are eligible (open template) |
| `allowStandaloneServers = false` | "No Group" option hidden, employee must pick a template |
| Multiple employees select same template | All join the same runtime TipGroup (find-or-create) |
| Last member clocks out | Normal group close logic (Skill 252) applies; next clock-in creates new runtime group |

---

## Testing

| # | Test | How to Verify |
|---|------|---------------|
| 1 | Template CRUD | Settings > Tips > Tip Group Teams > Create/Edit/Delete template |
| 2 | Clock-in group picker | Clock in employee with matching role → verify dialog shows |
| 3 | Group assignment | Select template → verify TimeClockEntry.selectedTipGroupId set |
| 4 | Single-group invariant | Employee already in group → select template → verify assignment fails gracefully |
| 5 | Role filtering | Create template with specific roles → verify only those roles see it |
| 6 | PRIMARY_SERVER_OWNS_ALL | Enable mode → co-owned table → pay → verify primary server gets full tip |
| 7 | Standalone toggle | Set false → verify "No Group" hidden |
| 8 | Ad-hoc group toggle | Set false → verify "Start New Group" hidden on /crew/tip-group |
