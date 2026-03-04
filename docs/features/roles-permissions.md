# Feature: Roles & Permissions

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Roles → read every listed dependency doc.

## Summary
Roles & Permissions gates every sensitive action in GWI POS. The system has 110 explicit permission keys organized into 4 tabs, risk-classified (LOW/MED/HIGH/CRITICAL), and filtered by role type (FOH/BOH/ADMIN) and access level (STAFF/MANAGER/OWNER_ADMIN). Server-side enforcement uses `requirePermission()` — never `{ soft: true }`. 8 built-in role templates provide starting points. Roles also configure cash handling mode, tip eligibility, and labor cost tracking. Multi-role employees are supported via the `EmployeeRole` junction table.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, permission registry, role admin UI, server-side enforcement | Full |
| `gwi-android-register` | Manager PIN gates for elevated actions | Partial |
| `gwi-cfd` | N/A (no permission checks on CFD) | None |
| `gwi-backoffice` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/roles` | Managers, Owners |
| Admin | Role editor — full-page 2-column layout (RoleEditorDrawer) | Managers, Owners |
| POS Web | Every sensitive action triggers `requirePermission()` server-side | All staff |
| Android | `ManagerPinViewModel` — PIN prompt for elevated actions | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/permission-registry.ts` | Single source of truth — 110 explicit permission definitions with metadata |
| `src/lib/auth-utils.ts` | `hasPermission()`, `PERMISSIONS` constants, `DEFAULT_ROLES`, `PERMISSION_GROUPS` |
| `src/lib/api-auth.ts` | `requirePermission()`, `requireAnyPermission()` — server-side enforcement |
| `src/app/api/roles/route.ts` | GET/POST — list/create roles |
| `src/app/api/roles/[id]/route.ts` | GET/PUT/DELETE — CRUD single role |
| `src/app/(admin)/roles/page.tsx` | Admin roles management page |
| `src/components/roles/RoleCard.tsx` | Role display card with badges |
| `src/components/roles/RoleEditorDrawer.tsx` | Full-page 2-column role editor (sidebar + main panel); props: `onBack/onSave/onDelete/roleToEdit/isCreating`; `logRegistryCoverage()` runs in `useEffect` for Fast Refresh safety |
| `src/components/roles/PermissionSection.tsx` | Tab-based permission groups with checkboxes |
| `src/components/roles/PermissionInfoPanel.tsx` | Info drawer with risk badge and details |
| `src/components/roles/EffectiveAccessPreview.tsx` | Read-only summary of role capabilities |
| `src/components/roles/TemplatePicker.tsx` | Template selector with diff preview |
| `src/components/roles/SegmentedControl.tsx` | Tab switching control |

### gwi-android-register
| File | Purpose |
|------|---------|
| `ui/auth/ManagerPinViewModel.kt` | Manager PIN prompt for elevated actions (voids, discounts) |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/roles` | None (needed by dropdowns) | List roles with employee counts |
| `POST` | `/api/roles` | `staff.manage_roles` | Create new role |
| `GET` | `/api/roles/[id]` | Employee PIN | Single role detail |
| `PUT` | `/api/roles/[id]` | Manager | Update role |
| `DELETE` | `/api/roles/[id]` | Manager | Soft delete (blocked if employees assigned) |

---

## Socket Events

Roles have no dedicated socket events. Permission changes take effect on the **next API call** — no real-time push needed.

---

## Data Model

### Role
```
id              String    @id
locationId      String
name            String
permissions     Json?               // Array of permission key strings
isTipped        Boolean   @default(false)
tipWeight       Decimal   @default(1.0)    // weight for tip-weighted splits
cashHandlingMode CashHandlingMode @default(drawer)  // drawer|purse|none
trackLaborCost  Boolean   @default(true)
roleType        String    @default("FOH")           // FOH|BOH|ADMIN (display only)
accessLevel     String    @default("STAFF")         // STAFF|MANAGER|OWNER_ADMIN (display only)
deletedAt       DateTime?                            // soft delete
```

### EmployeeRole (multi-role support)
```
id          String    @id
employeeId  String
roleId      String
isPrimary   Boolean   @default(false)
@@unique([employeeId, roleId])
```

### CashHandlingMode enum
```
drawer    // Physical drawer assigned at shift start
purse     // Server carries cash (server banking)
none      // No cash handling (barback, busser)
```

### Order (permission-gated field)
```
isTaxExempt  Boolean  @default(false)  // set via PUT /api/orders/[id] with MGR_TAX_EXEMPT
```
When `isTaxExempt` is true, `calculateOrderTotals` and `calculateSimpleOrderTotals` apply `taxRate = 0`. The exemption is recalculated immediately on toggle — no separate trigger needed.

---

## Permission Architecture

### Permission Tabs (4 categories)

| Tab | Key | Count | Description |
|-----|-----|-------|-------------|
| Shift & Service | `SHIFT_SERVICE` | 21 | POS access, payments, manager actions |
| Team & Time | `TEAM_TIME` | 20 | Staff management, scheduling, payroll |
| Reporting | `REPORTING` | 14 | Sales, labor, tips, export |
| Business Setup | `BUSINESS_SETUP` | 62 | Menu, inventory, customers, settings (17 granular) |

### Risk Levels

| Risk | Color | Behavior | Visible To |
|------|-------|----------|------------|
| LOW | Gray | Standard checkbox | All |
| MED | Blue | Standard checkbox | All |
| HIGH | Orange | Warning banner when checked | MANAGER, OWNER_ADMIN |
| CRITICAL | Red | Confirm dialog ("I understand") | OWNER_ADMIN only |

### Role Type Categories

| Category | Abbreviation | Description |
|----------|-------------|-------------|
| Front of House | `FOH` | Servers, bartenders, hosts |
| Back of House | `BOH` | Kitchen staff, prep, dish |
| Admin | `ADMIN` | Managers, owners |

### Access Levels

| Level | Description | Can See |
|-------|-------------|---------|
| STAFF | Front-line employees | LOW + MED permissions only |
| MANAGER | Shift managers | LOW + MED + HIGH |
| OWNER_ADMIN | Owners, super admins | ALL including CRITICAL |

### Permission Visibility Logic
```
getVisiblePermissionKeys(roleType, accessLevel, showAdvanced, allKeys)
```
- Filters by `applicableTo` (FOH/BOH/ADMIN match)
- STAFF: hides HIGH + CRITICAL
- MANAGER: hides CRITICAL
- OWNER_ADMIN: shows all
- `showAdvanced` toggle reveals advanced permissions

---

## Permission Checking

### Server-Side (API routes)
```typescript
// Standard pattern in every protected route:
const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_DISCOUNTS)
if (!auth.authorized) {
  return NextResponse.json({ error: auth.error }, { status: auth.status })
}
```

### hasPermission() Logic
1. If `admin`, `super_admin`, or `*` in permissions → **always true**
2. Exact match check
3. Wildcard pattern check: `pos.*` matches `pos.access`, `pos.table_service`, etc.

### CRITICAL: Never use `{ soft: true }`
All permission checks are hard enforcement. There is no soft/advisory mode.

### Protected Routes (complete list)

#### POS routes
| Method | Route | Permission | Condition |
|--------|-------|-----------|-----------|
| `POST` | `/api/orders/[id]/items` | `POS_EDIT_OTHERS_ORDERS` | Adding item to another employee's order |
| `POST` | `/api/orders/[id]/items` | `MGR_OPEN_ITEMS` | Any item price differs from menu price |
| `PUT/PATCH` | `/api/orders/[id]` | `POS_CHANGE_TABLE` | `tableId` changes |
| `PUT/PATCH` | `/api/orders/[id]` | `POS_CHANGE_SERVER` | `employeeId` changes to a different employee |
| `PUT/PATCH` | `/api/orders/[id]` | `MGR_TAX_EXEMPT` | `isTaxExempt` is set |
| `GET` | `/api/orders` | `POS_VIEW_OTHERS_ORDERS` | Filtering by a different employee |
| `POST` | `/api/print/cash-drawer` | `POS_NO_SALE` | Always |
| `POST` | `/api/orders/[id]/split` | `POS_SPLIT_CHECKS` | Always |
| `PUT` | `/api/orders/[id]/items/[itemId]` | `MGR_EDIT_SENT_ITEMS` | Item `kitchenStatus !== 'pending'` and request is a data update (not a kitchen action) |
| `POST` | `/api/orders/[id]/discount` | `MGR_DISCOUNTS` | Always |
| `POST` | `/api/orders/[id]/refund-payment` | `MGR_REFUNDS` | Always |
| `POST` | `/api/orders/[id]/comp-void` | `MGR_VOID_ITEMS` / `MGR_VOID_ORDERS` | Always |
| `POST` | `/api/orders/[id]/void-payment` | `MGR_VOID_PAYMENTS` | Always |

#### Shift/Staff routes
| Method | Route | Permission | Condition |
|--------|-------|-----------|-----------|
| `PUT` | `/api/shifts/[id]` | `MGR_CASH_VARIANCE_OVERRIDE` | `|variance| > $5` |
| `PUT` | `/api/employees/[id]` | `STAFF_EDIT_WAGES` | `hourlyRate` or `hireDate` in body |
| `PUT` | `/api/employees/[id]` | `STAFF_ASSIGN_ROLES` | `roleId` or `additionalRoleIds` in body |
| `POST` | `/api/tabs/[id]/transfer` | `MGR_TRANSFER_CHECKS` | Sender side |
| `POST` | `/api/tabs/[id]/transfer` | `MGR_RECEIVE_TRANSFERS` | Recipient side |

#### Deferred / not yet enforced at API level
- `manager.cash_drawer_blind` / `manager.cash_drawer_full` — UI-only gates; both modes submit the same `actualCash` to the same endpoint; no API distinction needed
- `manager.pay_in_out` — feature not yet built; `PaidInOut` model exists but no `POST` endpoint

---

## 8 Default Role Templates

| Template | Type | Access | Permissions | Key Capabilities |
|----------|------|--------|-------------|------------------|
| Server | FOH | STAFF | 13 | POS access, table service, payments, tips |
| Bartender | FOH | STAFF | 14 | Server + cash drawer, 86 items |
| Host | FOH | STAFF | 4 | Basic access, tables, customers |
| Security | FOH | STAFF | 3 | Minimal POS access |
| Kitchen Staff | BOH | STAFF | 5 | KDS, inventory, menu view/86 |
| Floor Manager | FOH | MANAGER | 27 | Full FOH ops, discounts, voids, reporting |
| BOH Manager | BOH | MANAGER | 15 | KDS, inventory, menu management, reports |
| Owner/Admin | ADMIN | OWNER_ADMIN | 1 (`admin`) | Full system access (admin bypasses all checks) |

---

## Key Permission Keys (by frequency of use)

### POS Access (13 keys)
| Key | Description |
|-----|-------------|
| `pos.access` | Basic POS access |
| `pos.table_service` | Table service mode |
| `pos.quick_order` | Quick order mode |
| `pos.kds` | KDS access |
| `pos.cash_payments` | Accept cash |
| `pos.card_payments` | Accept card |
| `pos.cash_drawer` | Open cash drawer |
| `pos.no_sale` | No-sale drawer open |
| `pos.split_checks` | Split checks |
| `pos.change_table` | Move order to different table |
| `pos.change_server` | Reassign server |
| `pos.view_others_orders` | View other servers' orders |
| `pos.edit_others_orders` | Edit other servers' orders |

### Manager Actions (20+ keys)
| Key | Risk | Description |
|-----|------|-------------|
| `manager.discounts` | HIGH | Apply discounts |
| `manager.void_items` | HIGH | Void/comp items |
| `manager.void_orders` | HIGH | Void entire orders |
| `manager.void_payments` | CRITICAL | Void payments |
| `manager.refunds` | CRITICAL | Process refunds |
| `manager.edit_sent_items` | HIGH | Edit items after send |
| `manager.transfer_checks` | HIGH | Transfer checks between servers |
| `manager.bulk_operations` | HIGH | Bulk close/void |
| `manager.tax_exempt` | HIGH | Apply tax exemption |
| `manager.close_day` | HIGH | End-of-day close |
| `manager.shift_review` | MED | Review shift reports |

### Settings (17 granular keys)
| Key | Description |
|-----|-------------|
| `settings.view` | View settings |
| `settings.edit` | Edit general settings |
| `settings.tax` | Tax configuration |
| `settings.receipts` | Receipt settings |
| `settings.payments` | Payment settings |
| `settings.dual_pricing` | Dual pricing config |
| `settings.venue` | Venue info |
| `settings.menu` | Menu settings |
| `settings.inventory` | Inventory settings |
| `settings.floor` | Floor plan settings |
| `settings.customers` | Customer settings |
| `settings.team` | Team settings |
| `settings.tips` | Tip settings |
| `settings.reports` | Report settings |
| `settings.hardware` | Hardware settings |
| `settings.security` | Security settings |
| `settings.integrations` | Integration settings |

---

## Business Logic

### Role Creation
1. Validate `staff.manage_roles` permission
2. Check for duplicate role name (per location)
3. Create role with permissions JSON array
4. Set roleType/accessLevel for UX classification
5. Configure cash handling, tip eligibility, labor tracking

### Role Editing
1. Load role with employee count
2. RoleEditorDrawer shows tab-based permission editor
3. Permission visibility filtered by roleType + accessLevel + advanced toggle
4. Template picker shows diff preview before applying
5. EffectiveAccessPreview summarizes capabilities in real-time
6. Save updates role record

### Role Deletion
1. Check if any employees assigned to role
2. If employees exist → 409 (cannot delete, must reassign first)
3. If no employees → soft delete (set `deletedAt`)

### Multi-Role Employees (Skill 249)
1. `EmployeeRole` junction table with `isPrimary` flag
2. At login, if employee has multiple roles, show role picker
3. Working role stored in auth store for session
4. Permissions are from the **working role**, not union of all roles

### Permission Inference
For unmapped permission keys (not in registry), `inferMeta()` generates:
- Label from key pattern (e.g., `pos.access` → "POS Access")
- Tab inference from prefix
- Default risk: LOW

As of commit `6aa78fe`, all 22 previously unmapped keys now have explicit registry entries with correct risk levels (no longer falling through to `inferMeta`). Keys added: `staff.scheduling` (MED); `reports.commission`, `reports.product_mix`, `reports.inventory`, `reports.tabs`, `reports.customers` (MED each); `reports.paid_in_out`, `reports.voids`, `reports.gift_cards` (HIGH each); `tables.view` (LOW), `tables.edit`, `tables.floor_plan`, `tables.reservations` (MED each); `tips.share`, `tips.collect`, `tips.manage_groups`, `tips.override_splits` (HIGH each); `tips.perform_adjustments` (CRITICAL); `inventory.view` (LOW), `inventory.counts`, `inventory.adjust_prep_stock`, `inventory.waste` (MED each).

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| **EVERY FEATURE** | Permissions gate every sensitive action across the system |
| Tips | `isTipped` + `tipWeight` on Role affect tip allocation |
| Shifts | `cashHandlingMode` determines shift start/close workflow |
| Reports | `trackLaborCost` determines labor cost inclusion |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Employees | Role assigned to employee via `Employee.roleId` |
| Settings | Role configuration stored per location |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Every feature** — adding/removing a permission key affects who can do what
- [ ] **auth-utils.ts** — if adding a new key, add it to `PERMISSIONS` constants
- [ ] **permission-registry.ts** — if adding a new key, add full metadata
- [ ] **Tips** — does this change affect isTipped or tipWeight behavior?
- [ ] **Shifts** — does this change affect cashHandlingMode workflow?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View roles | *(no permission required)* | — |
| Create role | `staff.manage_roles` | Critical |
| Edit role | `staff.manage_roles` | Critical |
| Delete role | `staff.manage_roles` | Critical |
| Assign role | `staff.assign_roles` | High |

---

## Known Constraints & Limits
- **110 explicit permission keys** — adding a new key requires updating both `auth-utils.ts` and `permission-registry.ts`
- **`admin` / `super_admin` bypass all checks** — these are god-mode permissions
- **Wildcard patterns** supported: `pos.*` matches all `pos.` prefixed permissions
- **roleType and accessLevel are UX-only** — never used for auth decisions
- **Cannot delete role with assigned employees** — must reassign first (409 error)
- **Permission changes are immediate** — no cache, no restart, takes effect on next API call
- **No socket events** — permission changes don't push to clients in real-time

---

## Android-Specific Notes
- `ManagerPinViewModel` prompts for manager PIN when elevated actions are attempted
- Manager PIN validation calls server-side `requirePermission()`
- Elevated actions gated on Android: voids, large discounts, refunds, cash adjustments
- No role admin UI on Android — role management is web admin only

---

## Related Docs
- **Domain doc:** `docs/domains/EMPLOYEES-DOMAIN.md`
- **Cross-ref matrix:** `docs/features/_CROSS-REF-MATRIX.md`
- **Multi-role spec:** `docs/skills/249-MULTI-ROLE-CASH-HANDLING-CREW-HUB.md`
- **Coding standards:** `docs/guides/CODING-STANDARDS.md` (API auth patterns)

---

*Last updated: 2026-03-03 (permissions enforcement sprint: 110 registry entries, full-page RoleEditorDrawer, protected routes complete)*
