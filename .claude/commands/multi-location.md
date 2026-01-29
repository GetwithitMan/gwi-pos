# Multi-Location Support

Manage multiple restaurant locations from a single system.

## Overview

GWI POS supports multi-location deployments with data isolation, shared menus (optional), and organization-level reporting.

## Hierarchy

```
Organization
├── Location 1 (Main Bar & Grill)
│   ├── Employees
│   ├── Menu
│   ├── Tables
│   ├── Orders
│   └── Settings
└── Location 2 (Downtown Branch)
    ├── Employees
    ├── Menu
    ├── Tables
    ├── Orders
    └── Settings
```

## Data Isolation

### Per-Location Data
Every table has `locationId`:
- Orders
- Employees
- Menu Items
- Categories
- Tables
- Payments
- Inventory
- Settings

### Query Pattern
```typescript
// Always filter by locationId
const orders = await db.order.findMany({
  where: { locationId: currentLocation.id }
})
```

## Location Selection

### On Login
1. Employee enters PIN
2. If employee at multiple locations:
   - Show location picker
   - Select location
3. Session bound to location

### Switch Location
1. Logout current location
2. Login with same PIN
3. Select different location

## Shared vs Separate

### Shared Across Locations
- Organization settings
- Multi-location employees
- Base menu templates (optional)
- Reporting rollups

### Separate Per Location
- Orders & payments
- Inventory levels
- Table layouts
- Tax rates
- Receipt text
- Local employees

## Menu Management

### Independent Menus
- Each location has own menu
- Complete customization
- Different prices

### Shared Menu Template
1. Create menu at org level
2. Push to locations
3. Locations can customize:
   - Enable/disable items
   - Adjust prices
   - Add local specials

### Sync Options
- One-way push
- Manual sync only
- Auto-sync changes

## Employee Access

### Single Location
- Employee works at one location
- Standard login

### Multi-Location
- Employee works at multiple locations
- Login prompts for location
- Different roles per location possible

### Location Assignment
```prisma
model Employee {
  id         String
  locations  EmployeeLocation[]  // Many-to-many
}

model EmployeeLocation {
  employeeId String
  locationId String
  roleId     String  // Role at this location
}
```

## Reporting

### Location Reports
- Sales for single location
- Standard report filters
- Local managers access

### Organization Reports
- Aggregate all locations
- Compare locations
- Owner/admin access only

### Report Scope
```
GET /api/reports/sales?locationId=loc-1        // Single location
GET /api/reports/sales?organizationId=org-1   // All locations
```

## Settings Hierarchy

### Organization Settings
- Default tax rate
- Branding
- Feature toggles
- Global roles

### Location Overrides
- Local tax rate
- Local receipt text
- Local hours
- Local settings

### Inheritance
```typescript
const taxRate = location.settings?.taxRate
  ?? organization.settings?.taxRate
  ?? 8.0  // Default
```

## API Patterns

### Location Context
All requests include location:
```
GET /api/orders?locationId=loc-1
POST /api/orders { locationId: "loc-1", ... }
```

### Organization Endpoints
Admin endpoints for org-level:
```
GET /api/organization/locations
GET /api/organization/reports
POST /api/organization/menu/sync
```

## Database Models

### Organization
```prisma
model Organization {
  id        String     @id
  name      String
  settings  Json?
  locations Location[]
}
```

### Location
```prisma
model Location {
  id             String       @id
  organizationId String
  organization   Organization @relation(...)
  name           String
  address        String?
  settings       Json?
  employees      Employee[]
  // ... all other relations
}
```

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Location relations |
| `src/stores/auth-store.ts` | Current location context |
| `src/middleware.ts` | Location validation |
| `src/app/api/organization/route.ts` | Org-level API |
| `src/components/LocationPicker.tsx` | Location selection |
