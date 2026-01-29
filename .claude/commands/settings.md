# Settings & Configuration

System-wide and location-specific settings management.

## Overview

Settings control global behaviors, tax rates, receipt formatting, and feature toggles. Accessed via `/settings` in the admin menu.

## Settings Categories

### General Settings
| Setting | Description |
|---------|-------------|
| Business Name | Displayed on receipts |
| Address | Location address |
| Phone | Contact number |
| Time Zone | Local time zone |
| Currency | USD, etc. |

### Tax Settings
| Setting | Description |
|---------|-------------|
| Default Tax Rate | Standard tax % |
| Tax Inclusive | Prices include tax |
| Tax Rules | Category-specific rates |

See `tax-rules.md` for details.

### Receipt Settings
| Setting | Description |
|---------|-------------|
| Header Text | Top of receipt |
| Footer Text | Bottom message |
| Show Server | Display server name |
| Tip Suggestions | Suggested percentages |

See `receipts.md` for details.

### Order Settings
| Setting | Description |
|---------|-------------|
| Auto-Close on Pay | Close order after payment |
| Require Table | Dine-in requires table |
| Default Guest Count | Starting count |
| Order Number Reset | Daily, never |

### Payment Settings
| Setting | Description |
|---------|-------------|
| Cash Discount | Discount for cash payments |
| Price Rounding | Round cash totals |
| Tip Screen | Show tip suggestions |
| Pre-Auth Amount | Bar tab hold amount |

### KDS Settings
| Setting | Description |
|---------|-------------|
| Routing | Where tickets print/display |
| Alert Times | Warning thresholds |
| Complete Mode | Single item vs full order |
| Sound Alerts | Audio notifications |

### Feature Toggles
| Feature | Enable/Disable |
|---------|----------------|
| Reservations | Table reservations |
| Waitlist | Walk-in waitlist |
| Loyalty | Points program |
| Gift Cards | Gift card sales |
| House Accounts | Credit accounts |
| Time Clock | Employee clock in/out |

## Quick Links

Settings page shows quick links to:
- Order Types
- Tip-Out Rules
- Tax Rules
- Printers
- Roles & Permissions

## Location vs Global

### Location Settings
- Tax rates
- Receipt text
- Business hours
- Address

### Global Settings
- Feature toggles
- Integrations
- Default roles

## Accessing Settings

### From POS
1. Click hamburger menu
2. Select "Settings"
3. Requires manager permission

### Direct URL
- `/settings` - Main settings
- `/settings/order-types` - Order types
- `/settings/tip-outs` - Tip rules
- `/settings/tax-rules` - Tax rules
- `/settings/printers` - Printers
- `/settings/roles` - Roles

## Permissions

| Permission | Access |
|------------|--------|
| `manage_settings` | Full settings access |
| `view_settings` | Read-only view |
| `admin` | All settings |

## API Endpoints

### Get Settings
```
GET /api/settings?locationId=xxx
```

### Update Settings
```
PATCH /api/settings
{
  "locationId": "xxx",
  "settings": {
    "taxRate": 8.5,
    "cashDiscount": 3
  }
}
```

## Database

### Location Settings
```prisma
model Location {
  id       String @id
  name     String
  settings Json?  // All location settings
}
```

### Settings Structure
```typescript
interface LocationSettings {
  tax: {
    defaultRate: number
    inclusive: boolean
  }
  receipt: {
    header: string
    footer: string
    showServer: boolean
  }
  order: {
    autoClose: boolean
    requireTable: boolean
    guestCountDefault: number
  }
  payment: {
    cashDiscount: number
    priceRounding: number
    tipSuggestions: number[]
  }
  features: {
    reservations: boolean
    waitlist: boolean
    loyalty: boolean
    giftCards: boolean
    timeClock: boolean
  }
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/settings/page.tsx` | Main settings page |
| `src/app/api/settings/route.ts` | Settings API |
| `src/lib/settings.ts` | Settings utilities |
| `src/hooks/useSettings.ts` | Settings hook |
