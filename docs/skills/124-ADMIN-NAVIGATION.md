# Skill 124: Admin Navigation Standardization

## Overview

Standardized admin page structure using reusable `AdminPageHeader` and `AdminSubNav` components across all admin sections (Menu, Customers, Team, Floor).

## Why This Matters

| Benefit | Description |
|---------|-------------|
| **Consistency** | All admin pages have the same header/navigation structure |
| **Maintainability** | Changes to navigation only need to happen in one place |
| **UX** | Users always know where they are via breadcrumbs and sub-nav highlighting |
| **Extensibility** | Adding new sections/pages follows a clear pattern |

## Components

### AdminPageHeader

Located at `src/components/admin/AdminPageHeader.tsx`

```typescript
interface AdminPageHeaderProps {
  title: string
  subtitle?: React.ReactNode  // Can be string or JSX
  breadcrumbs?: Breadcrumb[]
  backHref?: string
  actions?: React.ReactNode
}

interface Breadcrumb {
  label: string
  href: string
}
```

**Features:**
- Title with optional subtitle (ReactNode for JSX support)
- Breadcrumb navigation trail
- Optional back button with arrow icon
- Actions slot for buttons (right-aligned)

### AdminSubNav

Located at `src/components/admin/AdminSubNav.tsx`

**Pre-defined Configurations:**

```typescript
// Menu section
export const menuSubNav = [
  { label: 'Menu Items', href: '/menu' },
  { label: 'Modifiers', href: '/modifiers' },
  { label: 'Combos', href: '/combos' },
  { label: 'Ingredients', href: '/ingredients' },
]

// Customers section
export const customersSubNav = [
  { label: 'Customers', href: '/customers' },
  { label: 'Gift Cards', href: '/gift-cards' },
  { label: 'House Accounts', href: '/house-accounts' },
  { label: 'Coupons', href: '/coupons' },
]

// Team section
export const teamSubNav = [
  { label: 'Employees', href: '/employees' },
  { label: 'Roles', href: '/roles' },
  { label: 'Scheduling', href: '/scheduling' },
  { label: 'Payroll', href: '/payroll' },
  { label: 'Events', href: '/events' },
]

// Floor section
export const floorSubNav = [
  { label: 'Tables', href: '/tables' },
  { label: 'Floor Plan', href: '/floor-plan' },
  { label: 'Reservations', href: '/reservations' },
]
```

## Usage Pattern

### Standard Admin Page Template

```tsx
'use client'

import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, customersSubNav } from '@/components/admin/AdminSubNav'

export default function CustomersPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AdminSubNav items={customersSubNav} />

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <AdminPageHeader
          title="Customers"
          subtitle="Manage customer profiles and loyalty"
          breadcrumbs={[{ label: 'Admin', href: '/menu' }]}
          actions={
            <button className="...">Add Customer</button>
          }
        />

        {/* Page content here */}
      </main>
    </div>
  )
}
```

### With ReactNode Subtitle

```tsx
<AdminPageHeader
  title="House Accounts"
  subtitle={
    <span className="text-blue-600 font-semibold">
      ${formatCurrency(balance)} outstanding
    </span>
  }
/>
```

### With Back Button

```tsx
<AdminPageHeader
  title="Edit Customer"
  backHref="/customers"
  breadcrumbs={[
    { label: 'Admin', href: '/menu' },
    { label: 'Customers', href: '/customers' },
  ]}
/>
```

## Pages Updated

| Section | Route | SubNav Config |
|---------|-------|---------------|
| Customers | `/customers` | customersSubNav |
| Gift Cards | `/gift-cards` | customersSubNav |
| House Accounts | `/house-accounts` | customersSubNav |
| Coupons | `/coupons` | customersSubNav |
| Employees | `/employees` | teamSubNav |
| Roles | `/roles` | teamSubNav |
| Scheduling | `/scheduling` | teamSubNav |
| Payroll | `/payroll` | teamSubNav |
| Events | `/events` | teamSubNav |
| Tables | `/tables` | floorSubNav |
| Floor Plan | `/floor-plan` | floorSubNav |
| Reservations | `/reservations` | floorSubNav |

## Adding New Admin Pages

1. Create the page in `src/app/(admin)/your-page/page.tsx`
2. Import `AdminPageHeader` and the appropriate `*SubNav` config
3. If creating a new section, add a new subNav config to `AdminSubNav.tsx`
4. Follow the template pattern above

## Key Files

- `src/components/admin/AdminPageHeader.tsx` - Header component
- `src/components/admin/AdminSubNav.tsx` - Sub-navigation component with configs
