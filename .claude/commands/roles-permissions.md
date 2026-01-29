# Roles & Permissions

Detailed role-based access control system.

## Overview

GWI POS uses role-based access control (RBAC) to manage what each employee can do. Roles contain sets of permissions that grant or deny specific actions.

## Default Roles

### Owner
Full system access - all permissions granted.

### Manager
Administrative access with some restrictions:
- All POS functions
- Employee management
- Menu management
- Reports access
- Settings access
- Cannot delete organization

### Bartender
Bar-focused permissions:
- POS access
- Bar tabs
- Cash drawer
- Basic reports
- No menu editing

### Server
Table service permissions:
- POS access
- Table orders
- Own tips view
- No admin access

### Host
Front-of-house permissions:
- Reservations
- Waitlist
- Table status view
- No POS/payments

### Busser
Limited access:
- View orders
- Mark tables ready
- No payments

## Permission Categories

### POS Permissions

| Permission | Description |
|------------|-------------|
| `pos.access` | Can access POS |
| `pos.create_order` | Create new orders |
| `pos.modify_order` | Modify open orders |
| `pos.close_order` | Close/pay orders |
| `pos.transfer_order` | Transfer orders |
| `pos.reopen_order` | Reopen closed orders |

### Payment Permissions

| Permission | Description |
|------------|-------------|
| `payments.process` | Process payments |
| `payments.refund` | Issue refunds |
| `payments.void` | Void payments |
| `payments.open_drawer` | Open cash drawer |
| `payments.no_sale` | No sale drawer open |
| `payments.petty_cash` | Paid in/out |

### Order Permissions

| Permission | Description |
|------------|-------------|
| `orders.void_items` | Void unsent items |
| `orders.comp_items` | Comp sent items |
| `orders.apply_discount` | Apply discounts |
| `orders.price_override` | Override prices |
| `orders.custom_discount` | Custom discount % |
| `orders.view_all` | View all orders |
| `orders.view_own` | View own orders only |

### Menu Permissions

| Permission | Description |
|------------|-------------|
| `menu.view` | View menu |
| `menu.edit_items` | Edit menu items |
| `menu.edit_categories` | Edit categories |
| `menu.edit_modifiers` | Edit modifiers |
| `menu.edit_prices` | Change prices |
| `menu.toggle_available` | 86 items |

### Employee Permissions

| Permission | Description |
|------------|-------------|
| `employees.view` | View employee list |
| `employees.create` | Create employees |
| `employees.edit` | Edit employees |
| `employees.delete` | Delete employees |
| `employees.reset_pin` | Reset PINs |
| `employees.edit_roles` | Change roles |

### Report Permissions

| Permission | Description |
|------------|-------------|
| `reports.view` | Access reports |
| `reports.sales` | Sales reports |
| `reports.labor` | Labor reports |
| `reports.voids` | Void reports |
| `reports.tips` | Tips reports |
| `reports.inventory` | Inventory reports |
| `reports.export` | Export data |

### Settings Permissions

| Permission | Description |
|------------|-------------|
| `settings.view` | View settings |
| `settings.edit` | Modify settings |
| `settings.taxes` | Edit tax rules |
| `settings.printers` | Configure printers |
| `settings.order_types` | Edit order types |

### Tip Permissions

| Permission | Description |
|------------|-------------|
| `tips.view_own` | View own tips |
| `tips.view_all` | View all tips |
| `tips.share` | Share tips |
| `tips.collect` | Collect banked |
| `tips.manage_rules` | Edit tip rules |
| `tips.manage_bank` | Manage bank |

### Shift Permissions

| Permission | Description |
|------------|-------------|
| `shifts.clock_in_out` | Use time clock |
| `shifts.view_own` | View own shifts |
| `shifts.view_all` | View all shifts |
| `shifts.edit` | Edit shifts |
| `shifts.closeout` | Perform closeout |
| `shifts.override` | Override counts |

### Reservation Permissions

| Permission | Description |
|------------|-------------|
| `reservations.view` | View reservations |
| `reservations.create` | Create reservations |
| `reservations.edit` | Modify reservations |
| `reservations.cancel` | Cancel reservations |
| `reservations.waitlist` | Manage waitlist |

### Admin Permissions

| Permission | Description |
|------------|-------------|
| `admin` | Full admin access |
| `admin.roles` | Manage roles |
| `admin.locations` | Manage locations |
| `admin.integrations` | Manage integrations |
| `admin.backups` | Database backups |

## Creating Custom Roles

### In Admin UI
1. Go to `/settings/roles`
2. Click "Add Role"
3. Enter role name
4. Select permissions
5. Save

### Via API
```
POST /api/roles
{
  "locationId": "xxx",
  "name": "Shift Lead",
  "permissions": [
    "pos.access",
    "pos.create_order",
    "orders.void_items",
    "orders.apply_discount",
    "shifts.view_all"
  ]
}
```

## Permission Checking

### In Code
```typescript
// Check single permission
const canVoid = employee.permissions.includes('orders.void_items')

// Check any of multiple
const canManage = ['admin', 'employees.edit'].some(
  p => employee.permissions.includes(p)
)

// Check role name
const isManager = employee.role.name === 'Manager'
```

### In Components
```tsx
{employee.permissions.includes('reports.view') && (
  <Link href="/reports">Reports</Link>
)}
```

## Role Hierarchy

### Implicit Permissions
- `admin` grants all permissions
- `orders.view_all` includes `orders.view_own`
- `employees.edit` includes `employees.view`

### Override
Manager can grant permissions up to their own level. Cannot grant `admin` unless they have it.

## Database Model

### Role
```prisma
model Role {
  id          String   @id
  locationId  String
  name        String
  permissions Json     // Array of permission strings
  isSystem    Boolean  @default(false)
  employees   Employee[]
}
```

### Employee Role
```prisma
model Employee {
  roleId String
  role   Role @relation(...)
}
```

## Best Practices

### Principle of Least Privilege
- Grant minimum needed permissions
- Use specific permissions over admin
- Review regularly

### Role Design
- Create roles by job function
- Don't create role per person
- Keep manageable number of roles

### Audit
- Track permission changes
- Review high-privilege accounts
- Log sensitive actions

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/settings/roles/page.tsx` | Role management |
| `src/app/api/roles/route.ts` | Roles API |
| `src/stores/auth-store.ts` | Permission checking |
| `src/lib/permissions.ts` | Permission utilities |
| `prisma/schema.prisma` | Role model |
